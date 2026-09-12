"""
Fine-tunes R(2+1)D-18 on the UCF101 dataset (full 101 classes by default —
see USE_ALL_CLASSES in src/config.py).

Precautions built into this script, and why:
  - Class-weighted loss: UCF101 classes are naturally imbalanced (roughly
    70-160 clips/class). Without weighting, the model would bias toward
    common classes. Weights are computed from the actual on-disk train
    counts, not assumed.
  - Early stopping: training stops once validation loss stops improving
    for EARLY_STOPPING_PATIENCE epochs, rather than always running the
    full NUM_EPOCHS. This avoids wasting free-tier GPU time and reduces
    overfitting risk at 101-class scale.
  - LR warmup + cosine decay: a flat cosine schedule from step 1 can
    destabilize fine-tuning right when the newly-initialized final layer
    has large gradients. A short linear warmup avoids this.
  - Gradient clipping: guards against the occasional large gradient
    spike, which becomes more likely with more classes/more data.
  - Mixed precision: keeps the larger 101-class fully-connected layer and
    batch memory footprint inside a single 16GB GPU.
  - Every epoch's metrics are appended to outputs/training_history.json
    so the frontend can plot real training curves, not fabricated ones.

Usage:
    python src/train.py
"""

import json
import os
import sys
import time

import numpy as np
import torch
import torch.nn as nn
from torch.cuda.amp import GradScaler, autocast
from torch.optim import AdamW
from torch.optim.lr_scheduler import LinearLR, CosineAnnealingLR, SequentialLR
from torch.utils.data import DataLoader
from tqdm import tqdm

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.config import (  # noqa: E402
    BATCH_SIZE, CHECKPOINT_DIR, DATA_DIR, EARLY_STOPPING_MIN_DELTA,
    EARLY_STOPPING_PATIENCE, FRAME_SIZE, GRAD_CLIP_NORM, HISTORY_FILE,
    LEARNING_RATE, NUM_EPOCHS, NUM_FRAMES, NUM_WORKERS, OUTPUT_DIR, SEED,
    USE_CLASS_WEIGHTS, WARMUP_EPOCHS, WEIGHT_DECAY, get_classes,
)
from src.dataset import VideoClipDataset  # noqa: E402
from src.model import build_model  # noqa: E402
from src.utils import get_device, set_seed  # noqa: E402


def compute_class_weights(dataset: VideoClipDataset, num_classes: int) -> torch.Tensor:
    """
    Inverse-frequency class weights from the ACTUAL train split on disk
    (not an assumed/theoretical distribution). Rare classes get a higher
    weight so the loss doesn't get dominated by common ones.
    """
    counts = np.zeros(num_classes, dtype=np.float64)
    for _, label in dataset.samples:
        counts[label] += 1
    counts = np.maximum(counts, 1)  # avoid div-by-zero for any empty class
    weights = counts.sum() / (num_classes * counts)
    return torch.tensor(weights, dtype=torch.float32)


def run_epoch(model, loader, criterion, optimizer, scaler, device, train: bool, grad_clip: float):
    model.train() if train else model.eval()
    total_loss, correct, total = 0.0, 0, 0

    context = torch.enable_grad() if train else torch.no_grad()
    with context:
        for clips, labels in tqdm(loader, desc="train" if train else "val", leave=False):
            clips, labels = clips.to(device), labels.to(device)

            if train:
                optimizer.zero_grad()
                with autocast(enabled=device.type == "cuda"):
                    outputs = model(clips)
                    loss = criterion(outputs, labels)
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(
                    filter(lambda p: p.requires_grad, model.parameters()), grad_clip
                )
                scaler.step(optimizer)
                scaler.update()
            else:
                with autocast(enabled=device.type == "cuda"):
                    outputs = model(clips)
                    loss = criterion(outputs, labels)

            total_loss += loss.item() * clips.size(0)
            correct += (outputs.argmax(dim=1) == labels).sum().item()
            total += clips.size(0)

    return total_loss / total, correct / total


def build_scheduler(optimizer, warmup_epochs: int, total_epochs: int):
    if warmup_epochs <= 0:
        return CosineAnnealingLR(optimizer, T_max=total_epochs)
    warmup = LinearLR(optimizer, start_factor=0.1, total_iters=warmup_epochs)
    cosine = CosineAnnealingLR(optimizer, T_max=max(total_epochs - warmup_epochs, 1))
    return SequentialLR(optimizer, schedulers=[warmup, cosine], milestones=[warmup_epochs])


def main():
    set_seed(SEED)
    device = get_device()
    print(f"Using device: {device}")
    os.makedirs(CHECKPOINT_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("\n=== STAGE 1: DATA LOADING ===")
    classes = get_classes()
    print(f"Training on {len(classes)} classes.")

    train_ds = VideoClipDataset(
        os.path.join(DATA_DIR, "train"), classes, NUM_FRAMES, FRAME_SIZE, train=True
    )
    test_ds = VideoClipDataset(
        os.path.join(DATA_DIR, "test"), classes, NUM_FRAMES, FRAME_SIZE, train=False
    )
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True,
                               num_workers=NUM_WORKERS, pin_memory=True)
    test_loader = DataLoader(test_ds, batch_size=BATCH_SIZE, shuffle=False,
                              num_workers=NUM_WORKERS, pin_memory=True)
    print(f"Train clips: {len(train_ds)} | Test clips: {len(test_ds)}")

    print("\n=== STAGE 2: MODEL + LOSS SETUP ===")
    model = build_model(num_classes=len(classes)).to(device)

    if USE_CLASS_WEIGHTS:
        class_weights = compute_class_weights(train_ds, len(classes)).to(device)
        criterion = nn.CrossEntropyLoss(weight=class_weights)
        print("Class-weighted loss enabled (inverse frequency from train split).")
    else:
        criterion = nn.CrossEntropyLoss()
        print("Class-weighted loss disabled — using plain CrossEntropyLoss.")

    optimizer = AdamW(filter(lambda p: p.requires_grad, model.parameters()),
                       lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)
    scheduler = build_scheduler(optimizer, WARMUP_EPOCHS, NUM_EPOCHS)
    scaler = GradScaler(enabled=device.type == "cuda")
    print(f"Optimizer: AdamW | LR: {LEARNING_RATE} | Warmup epochs: {WARMUP_EPOCHS} | "
          f"Grad clip norm: {GRAD_CLIP_NORM}")

    print("\n=== STAGE 3: TRAINING (with early stopping) ===")
    best_val_loss = float("inf")
    best_acc = 0.0
    epochs_without_improvement = 0
    history = []

    for epoch in range(1, NUM_EPOCHS + 1):
        start = time.time()
        train_loss, train_acc = run_epoch(model, train_loader, criterion, optimizer, scaler,
                                           device, train=True, grad_clip=GRAD_CLIP_NORM)
        val_loss, val_acc = run_epoch(model, test_loader, criterion, optimizer, scaler,
                                       device, train=False, grad_clip=GRAD_CLIP_NORM)
        scheduler.step()
        elapsed = time.time() - start
        current_lr = optimizer.param_groups[0]["lr"]

        print(f"Epoch {epoch:02d}/{NUM_EPOCHS} | "
              f"train_loss {train_loss:.4f} acc {train_acc:.3f} | "
              f"val_loss {val_loss:.4f} acc {val_acc:.3f} | "
              f"lr {current_lr:.2e} | {elapsed:.1f}s")

        history.append({
            "epoch": epoch, "train_loss": train_loss, "train_acc": train_acc,
            "val_loss": val_loss, "val_acc": val_acc, "lr": current_lr, "seconds": elapsed,
        })
        with open(HISTORY_FILE, "w") as f:
            json.dump(history, f, indent=2)

        if val_acc > best_acc:
            best_acc = val_acc
            ckpt_path = os.path.join(CHECKPOINT_DIR, "best_model.pt")
            torch.save({"model_state": model.state_dict(), "classes": classes, "val_acc": val_acc}, ckpt_path)
            print(f"  ↳ New best model saved ({val_acc:.3f}) -> {ckpt_path}")

        # Early stopping precaution: stop once val_loss stops improving
        # meaningfully, rather than always burning the full epoch budget.
        if val_loss < best_val_loss - EARLY_STOPPING_MIN_DELTA:
            best_val_loss = val_loss
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1
            print(f"  ↳ No meaningful val_loss improvement "
                  f"({epochs_without_improvement}/{EARLY_STOPPING_PATIENCE})")
            if epochs_without_improvement >= EARLY_STOPPING_PATIENCE:
                print(f"\nEarly stopping triggered at epoch {epoch} "
                      f"(no val_loss improvement for {EARLY_STOPPING_PATIENCE} epochs).")
                break

    print(f"\n=== STAGE 4: DONE ===")
    print(f"Best val accuracy: {best_acc:.3f}")
    print(f"Training history saved to: {HISTORY_FILE}")


if __name__ == "__main__":
    main()
