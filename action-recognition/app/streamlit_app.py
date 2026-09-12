"""
Step-by-step frontend for the action recognition pipeline.

Every stage of the system — data balance, preprocessing, training
dynamics, evaluation, and live prediction — is shown as its own
numbered block, so a viewer can see exactly what the model is doing and
why, rather than a single black-box "upload and predict" screen.

Run locally after downloading the trained artifacts (checkpoint,
outputs/, data/UCF101_subset/) from Colab/Kaggle:

    streamlit run app/streamlit_app.py

If running remotely (Colab/Kaggle) without downloading artifacts first,
you'll need a tunnel (e.g. `pip install pyngrok` + a couple of extra
lines) since Colab/Kaggle don't expose local ports directly. Running
locally after downloading results is simpler and is the documented path
in the README.
"""

import json
import os
import random
import sys

import cv2
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
import torch

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.config import (  # noqa: E402
    CLASS_DIST_FILE, DATA_DIR, EARLY_STOPPING_PATIENCE, FRAME_SIZE,
    GRAD_CLIP_NORM, HISTORY_FILE, LEARNING_RATE, NUM_FRAMES, OUTPUT_DIR,
    USE_ALL_CLASSES, USE_CLASS_WEIGHTS, WARMUP_EPOCHS, get_classes,
)
from src.dataset import MEAN, STD, load_clip, sample_frame_indices  # noqa: E402
from src.model import build_model  # noqa: E402
from src.utils import get_device  # noqa: E402

st.set_page_config(page_title="Action Recognition — Pipeline Explainer", layout="wide")

CHECKPOINT_PATH = os.path.join("checkpoints", "best_model.pt")


# ---------------------------------------------------------------------------
# Cached loaders — avoid re-loading the model/dataset index on every rerun
# ---------------------------------------------------------------------------
@st.cache_resource
def load_model_and_classes():
    if not os.path.exists(CHECKPOINT_PATH):
        return None, None, None, None
    try:
        device = get_device()
        ckpt = torch.load(CHECKPOINT_PATH, map_location=device)
        classes = ckpt.get("classes", get_classes())
        model = build_model(num_classes=len(classes), freeze_backbone=False, pretrained=False).to(device)
        model.load_state_dict(ckpt["model_state"])
        model.eval()
        return model, classes, device, None
    except Exception as e:
        # Precaution: a corrupted checkpoint or environment issue shouldn't
        # take down the whole dashboard — surface it in Step 6 instead.
        return None, None, None, str(e)


@st.cache_data
def load_class_distribution():
    if not os.path.exists(CLASS_DIST_FILE):
        return None
    with open(CLASS_DIST_FILE) as f:
        return json.load(f)


@st.cache_data
def load_training_history():
    if not os.path.exists(HISTORY_FILE):
        return None
    with open(HISTORY_FILE) as f:
        return json.load(f)


@st.cache_data
def list_test_clips(_classes):
    clips = []
    test_root = os.path.join(DATA_DIR, "test")
    if not os.path.isdir(test_root):
        return clips
    for class_name in _classes:
        class_dir = os.path.join(test_root, class_name)
        if not os.path.isdir(class_dir):
            continue
        for fname in os.listdir(class_dir):
            if fname.lower().endswith((".avi", ".mp4")):
                clips.append((os.path.join(class_dir, fname), class_name))
    return clips


# ---------------------------------------------------------------------------
# Sidebar — precautions panel (always visible, per the project's
# requirement to state where and why safeguards were applied)
# ---------------------------------------------------------------------------
with st.sidebar:
    st.header("⚠️ Precautions taken")
    st.markdown(
        """
**Data leakage** — UCF101 clips are split into train/test at the *source
group* level (same actor/background), not per-clip. Splitting per-clip
lets the model memorize the scene instead of the action, silently
inflating accuracy. This was caught and fixed after an initial 100%
"perfect" result exposed it.

**Class imbalance** — UCF101 classes vary from ~70–160 clips each. Loss
is weighted by inverse class frequency (computed from the real on-disk
counts each run), not left unweighted.

**Reproducibility** — every random seed (Python, NumPy, PyTorch, CUDA)
is fixed, so results are repeatable, not lucky.

**Early stopping** — training halts once validation loss stops improving
for several epochs, rather than always running a fixed epoch count. This
avoids wasted compute and overfitting on a fixed free-tier GPU budget.

**Gradient clipping & mixed precision** — guard against training
instability and GPU memory overruns at full 101-class scale.

**Hyperparameter search is bounded, not exhaustive** — a full grid
search isn't feasible on free-tier Colab/Kaggle GPU time. A small,
documented probe search picks a reasonable starting configuration
instead of an unqualified "best" one.

**Corrupted/unreadable clips** — the data loader returns a black
placeholder clip rather than crashing an entire training batch.
        """
    )

st.title("Action Recognition in Videos — Pipeline Explainer")
st.caption(
    "Every block below is a real stage of the pipeline, reading from files this project's "
    "own scripts produced — nothing here is mocked or hardcoded."
)

classes = get_classes()

# ---------------------------------------------------------------------------
# STEP 1 — Dataset & class balance
# ---------------------------------------------------------------------------
st.header("Step 1 — Dataset & Class Balance")
st.write(
    f"Training on **{len(classes)} classes** "
    f"({'auto-discovered, full UCF101' if USE_ALL_CLASSES else 'fixed subset'})."
)

dist = load_class_distribution()
if dist is None:
    st.info("No class_distribution.json found yet — run `python data/download_ucf101.py` first.")
else:
    df = pd.DataFrame([
        {"class": k, "train": v["train"], "test": v["test"]} for k, v in dist.items()
    ]).sort_values("train", ascending=False)

    train_counts = df["train"][df["train"] > 0]
    imbalance_ratio = train_counts.max() / train_counts.min() if len(train_counts) else 0

    col1, col2 = st.columns([3, 1])
    with col1:
        fig = px.bar(df, x="class", y=["train", "test"], barmode="group",
                     title="Clips per class (train vs test)")
        fig.update_layout(xaxis_tickangle=-60, height=420)
        st.plotly_chart(fig, width="stretch")
    with col2:
        st.metric("Classes", len(df))
        st.metric("Total train clips", int(df["train"].sum()))
        st.metric("Total test clips", int(df["test"].sum()))
        st.metric("Imbalance ratio (max/min)", f"{imbalance_ratio:.2f}x")
        if imbalance_ratio > 2:
            st.warning("Meaningful imbalance — class-weighted loss is active (see sidebar).")

# ---------------------------------------------------------------------------
# STEP 2 — Data preprocessing pipeline (live demo on a real clip)
# ---------------------------------------------------------------------------
st.header("Step 2 — Data Preprocessing Pipeline")
st.write(
    "This is the exact preprocessing every clip goes through before reaching the model: "
    "frame sampling → resize → normalize."
)

all_clips = list_test_clips(tuple(classes))
if not all_clips:
    st.info("No test clips found yet — run `python data/download_ucf101.py` first.")
else:
    if st.button("🔀 Pick a random clip to preprocess"):
        st.session_state["preprocess_clip"] = random.choice(all_clips)
    if "preprocess_clip" not in st.session_state:
        st.session_state["preprocess_clip"] = random.choice(all_clips)

    clip_path, clip_class = st.session_state["preprocess_clip"]
    st.write(f"Selected clip: **{os.path.basename(clip_path)}** (true class: **{clip_class}**)")

    cap = cv2.VideoCapture(clip_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    indices = sorted(set(sample_frame_indices(total_frames, NUM_FRAMES, train=False).tolist()))

    st.markdown(f"**2a. Frame sampling** — {total_frames} total frames in this clip, "
                f"{NUM_FRAMES} sampled evenly: frame indices `{indices}`")

    raw_frames, resized_frames = [], []
    idx, wanted = 0, set(indices)
    while cap.isOpened() and len(raw_frames) < len(wanted):
        ret, frame = cap.read()
        if not ret:
            break
        if idx in wanted:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            raw_frames.append(rgb)
            resized_frames.append(cv2.resize(rgb, (FRAME_SIZE, FRAME_SIZE)))
        idx += 1
    cap.release()

    st.markdown("**2b. Sampled frames (original resolution)**")
    cols = st.columns(min(8, len(raw_frames)))
    for i, frame in enumerate(raw_frames[:8]):
        cols[i % len(cols)].image(frame, width="stretch", caption=f"frame {indices[i]}")

    st.markdown(f"**2c. Resized to {FRAME_SIZE}×{FRAME_SIZE}** (model input size)")
    cols2 = st.columns(min(8, len(resized_frames)))
    for i, frame in enumerate(resized_frames[:8]):
        cols2[i % len(cols2)].image(frame, width="stretch")

    normalized_sample = (resized_frames[0].astype(np.float32) / 255.0 - MEAN) / STD
    st.markdown(
        "**2d. Normalization** — pixel values scaled to [0,1] then normalized with "
        f"Kinetics mean/std. Example pixel value range after normalization: "
        f"`[{normalized_sample.min():.2f}, {normalized_sample.max():.2f}]` "
        "(shown numerically since normalized values aren't directly viewable as an image)."
    )

# ---------------------------------------------------------------------------
# STEP 3 — Model & training configuration
# ---------------------------------------------------------------------------
st.header("Step 3 — Model & Training Configuration")
col1, col2 = st.columns(2)
with col1:
    st.markdown(
        f"""
- **Backbone:** R(2+1)D-18, pretrained on Kinetics-400
- **Fine-tuning strategy:** last residual block + classifier head unfrozen, rest frozen
- **Learning rate:** {LEARNING_RATE} (with {WARMUP_EPOCHS}-epoch linear warmup → cosine decay)
- **Gradient clip norm:** {GRAD_CLIP_NORM}
- **Class-weighted loss:** {"enabled" if USE_CLASS_WEIGHTS else "disabled"}
- **Early stopping patience:** {EARLY_STOPPING_PATIENCE} epochs
        """
    )
with col2:
    hparam_path = os.path.join(OUTPUT_DIR, "best_hparams.json")
    if os.path.exists(hparam_path):
        with open(hparam_path) as f:
            hp = json.load(f)
        st.markdown("**Bounded hyperparameter probe results:**")
        hp_df = pd.DataFrame(hp["all_results"]).sort_values("probe_val_acc", ascending=False)
        st.dataframe(hp_df, width="stretch", hide_index=True)
        st.caption("Short-run probe only (see sidebar) — used to pick a starting configuration.")
    else:
        st.info("Run `python src/hyperparam_search.py` to see probe search results here.")

# ---------------------------------------------------------------------------
# STEP 4 — Training history
# ---------------------------------------------------------------------------
st.header("Step 4 — Training History")
history = load_training_history()
if history is None:
    st.info("No training_history.json found yet — run `python src/train.py` first.")
else:
    hist_df = pd.DataFrame(history)
    best_epoch = hist_df.loc[hist_df["val_acc"].idxmax(), "epoch"]

    fig_loss = go.Figure()
    fig_loss.add_trace(go.Scatter(x=hist_df["epoch"], y=hist_df["train_loss"], name="train loss"))
    fig_loss.add_trace(go.Scatter(x=hist_df["epoch"], y=hist_df["val_loss"], name="val loss"))
    fig_loss.add_vline(x=best_epoch, line_dash="dash", annotation_text="best epoch")
    fig_loss.update_layout(title="Loss over training", height=350)

    fig_acc = go.Figure()
    fig_acc.add_trace(go.Scatter(x=hist_df["epoch"], y=hist_df["train_acc"], name="train acc"))
    fig_acc.add_trace(go.Scatter(x=hist_df["epoch"], y=hist_df["val_acc"], name="val acc"))
    fig_acc.add_vline(x=best_epoch, line_dash="dash", annotation_text="best epoch")
    fig_acc.update_layout(title="Accuracy over training", height=350)

    c1, c2 = st.columns(2)
    c1.plotly_chart(fig_loss, width="stretch")
    c2.plotly_chart(fig_acc, width="stretch")

    if len(hist_df) < 40:  # NUM_EPOCHS default upper bound
        st.info(f"Training ran for {len(hist_df)} epochs (stopped by early stopping, "
                f"not the full budget) — best epoch was {int(best_epoch)}.")

# ---------------------------------------------------------------------------
# STEP 5 — Evaluation results
# ---------------------------------------------------------------------------
st.header("Step 5 — Evaluation Results")
report_path = os.path.join(OUTPUT_DIR, "classification_report.txt")
cm_path = os.path.join(OUTPUT_DIR, "confusion_matrix.png")
col1, col2 = st.columns([1, 1])
with col1:
    if os.path.exists(report_path):
        with open(report_path) as f:
            st.text(f.read())
    else:
        st.info("Run `python src/evaluate.py` to generate the classification report.")
with col2:
    if os.path.exists(cm_path):
        st.image(cm_path, width="stretch", caption="Confusion matrix")
    else:
        st.info("Run `python src/evaluate.py` to generate the confusion matrix.")

# ---------------------------------------------------------------------------
# STEP 6 — Live prediction + explanation
# ---------------------------------------------------------------------------
st.header("Step 6 — Live Prediction")
model, ckpt_classes, device, load_error = load_model_and_classes()

if load_error is not None:
    st.error(f"Could not load the trained model: {load_error}")
elif model is None:
    st.info("No trained checkpoint found at checkpoints/best_model.pt — train the model first.")
elif not all_clips:
    st.info("No test clips available to predict on.")
else:
    if st.button("🎯 Predict on a random test clip"):
        st.session_state["predict_clip"] = random.choice(all_clips)
    if "predict_clip" not in st.session_state:
        st.session_state["predict_clip"] = random.choice(all_clips)

    pred_path, true_label = st.session_state["predict_clip"]
    clip = load_clip(pred_path, NUM_FRAMES, FRAME_SIZE, train=False)
    clip_n = (clip.astype(np.float32) / 255.0 - MEAN) / STD
    tensor = torch.from_numpy(clip_n.copy()).permute(3, 0, 1, 2).unsqueeze(0).float().to(device)

    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1)[0].cpu().numpy()

    top5_idx = probs.argsort()[-5:][::-1]
    top5_df = pd.DataFrame({
        "class": [ckpt_classes[i] for i in top5_idx],
        "probability": [probs[i] for i in top5_idx],
    })

    pred_label = ckpt_classes[int(probs.argmax())]
    correct = pred_label == true_label

    col1, col2 = st.columns([1, 1])
    with col1:
        st.write(f"Clip: **{os.path.basename(pred_path)}**")
        st.write(f"True label: **{true_label}**")
        if correct:
            st.success(f"Predicted: **{pred_label}** ✓")
        else:
            st.error(f"Predicted: **{pred_label}** ✗")
        mid_frame = clip[len(clip) // 2]
        st.image(mid_frame, caption="Middle frame of clip", width="stretch")
    with col2:
        fig = px.bar(top5_df, x="probability", y="class", orientation="h",
                     title="Top-5 predicted classes")
        fig.update_layout(yaxis={"categoryorder": "total ascending"}, height=350)
        st.plotly_chart(fig, width="stretch")

    st.caption(
        "For a pose-skeleton overlay version of predictions like this, run "
        "`python src/visualize_pose_predictions.py` and check outputs/pose_visualizations/."
    )
