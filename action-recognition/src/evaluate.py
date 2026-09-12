"""
Evaluates a trained checkpoint on the test split and reports every
metric the project brief asks for:
  - top-1 and top-5 accuracy
  - confusion matrix (saved as an image)
  - precision / recall / F1 per class
  - average inference time per clip

Usage:
    python src/evaluate.py --checkpoint checkpoints/best_model.pt
"""

import argparse
import os
import sys
import time

import matplotlib.pyplot as plt
import numpy as np
import seaborn as sns
import torch
from sklearn.metrics import classification_report, confusion_matrix
from torch.utils.data import DataLoader
from tqdm import tqdm

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.config import DATA_DIR, FRAME_SIZE, NUM_FRAMES, OUTPUT_DIR, get_classes  # noqa: E402
from src.dataset import VideoClipDataset  # noqa: E402
from src.model import build_model  # noqa: E402
from src.utils import get_device  # noqa: E402


def top_k_correct(outputs: torch.Tensor, labels: torch.Tensor, k: int) -> int:
    topk = outputs.topk(k, dim=1).indices
    return (topk == labels.unsqueeze(1)).any(dim=1).sum().item()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", default=os.path.join("checkpoints", "best_model.pt"))
    args = parser.parse_args()

    device = get_device()
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    ckpt = torch.load(args.checkpoint, map_location=device)
    classes = ckpt.get("classes", get_classes())

    model = build_model(num_classes=len(classes), freeze_backbone=False, pretrained=False).to(device)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    test_ds = VideoClipDataset(os.path.join(DATA_DIR, "test"), classes, NUM_FRAMES, FRAME_SIZE, train=False)
    test_loader = DataLoader(test_ds, batch_size=1, shuffle=False)

    all_preds, all_labels = [], []
    top1_correct, top5_correct, total = 0, 0, 0
    inference_times = []

    with torch.no_grad():
        for clip, label in tqdm(test_loader, desc="evaluating"):
            clip, label = clip.to(device), label.to(device)

            start = time.time()
            outputs = model(clip)
            if device.type == "cuda":
                torch.cuda.synchronize()
            inference_times.append(time.time() - start)

            top1_correct += top_k_correct(outputs, label, k=1)
            top5_correct += top_k_correct(outputs, label, k=min(5, len(classes)))
            total += clip.size(0)

            all_preds.append(outputs.argmax(dim=1).item())
            all_labels.append(label.item())

    top1_acc = top1_correct / total
    top5_acc = top5_correct / total
    avg_inference_ms = np.mean(inference_times) * 1000

    print(f"\nTop-1 accuracy: {top1_acc:.4f}")
    print(f"Top-5 accuracy: {top5_acc:.4f}")
    print(f"Avg inference time per clip: {avg_inference_ms:.2f} ms")

    print("\nClassification report:")
    report = classification_report(all_labels, all_preds, target_names=classes, digits=3)
    print(report)
    with open(os.path.join(OUTPUT_DIR, "classification_report.txt"), "w") as f:
        f.write(f"Top-1 accuracy: {top1_acc:.4f}\n")
        f.write(f"Top-5 accuracy: {top5_acc:.4f}\n")
        f.write(f"Avg inference time per clip: {avg_inference_ms:.2f} ms\n\n")
        f.write(report)

    cm = confusion_matrix(all_labels, all_preds)
    plt.figure(figsize=(9, 7))
    sns.heatmap(cm, annot=True, fmt="d", xticklabels=classes, yticklabels=classes, cmap="Blues")
    plt.xlabel("Predicted")
    plt.ylabel("True")
    plt.title("Confusion Matrix")
    plt.tight_layout()
    cm_path = os.path.join(OUTPUT_DIR, "confusion_matrix.png")
    plt.savefig(cm_path, dpi=150)
    print(f"\nConfusion matrix saved to {cm_path}")
    print(f"Full report saved to {os.path.join(OUTPUT_DIR, 'classification_report.txt')}")


if __name__ == "__main__":
    main()
