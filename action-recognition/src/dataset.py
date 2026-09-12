"""
VideoClipDataset: reads a video file, samples a fixed number of frames
evenly across its duration, and returns a (C, T, H, W) tensor ready for
torchvision.models.video models (e.g. r2plus1d_18).
"""

import os
import random

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

# ImageNet/Kinetics-style normalization used by torchvision's video models
MEAN = np.array([0.43216, 0.394666, 0.37645], dtype=np.float32)
STD = np.array([0.22803, 0.22145, 0.216989], dtype=np.float32)


def sample_frame_indices(total_frames: int, num_frames: int, train: bool) -> np.ndarray:
    """Evenly spaced frame indices, with a little random jitter during training."""
    if total_frames <= num_frames:
        # repeat frames if the clip is shorter than num_frames
        return np.linspace(0, max(total_frames - 1, 0), num_frames).astype(int)

    if train:
        # temporal jitter: shift the evenly spaced window slightly at random
        max_offset = total_frames // num_frames
        base = np.linspace(0, total_frames - max_offset - 1, num_frames)
        jitter = np.random.randint(0, max(max_offset, 1), size=num_frames)
        indices = (base + jitter).astype(int)
    else:
        indices = np.linspace(0, total_frames - 1, num_frames).astype(int)

    return np.clip(indices, 0, total_frames - 1)


def load_clip(video_path: str, num_frames: int, frame_size: int, train: bool) -> np.ndarray:
    cap = cv2.VideoCapture(video_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    indices = set(sample_frame_indices(total_frames, num_frames, train).tolist())

    frames = {}
    idx = 0
    while cap.isOpened() and len(frames) < len(indices):
        ret, frame = cap.read()
        if not ret:
            break
        if idx in indices:
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frame = cv2.resize(frame, (frame_size, frame_size))
            frames[idx] = frame
        idx += 1
    cap.release()

    if not frames:
        # corrupt/unreadable video — return a black clip rather than crashing a batch
        return np.zeros((num_frames, frame_size, frame_size, 3), dtype=np.uint8)

    ordered = sorted(frames.keys())
    clip = np.stack([frames[i] for i in ordered])
    if clip.shape[0] < num_frames:
        pad = np.repeat(clip[-1:], num_frames - clip.shape[0], axis=0)
        clip = np.concatenate([clip, pad], axis=0)
    return clip


class VideoClipDataset(Dataset):
    """
    Expects a directory layout of:
        root/<ClassName>/*.avi
    """

    def __init__(self, root: str, classes: list, num_frames: int, frame_size: int, train: bool):
        self.root = root
        self.classes = classes
        self.class_to_idx = {c: i for i, c in enumerate(classes)}
        self.num_frames = num_frames
        self.frame_size = frame_size
        self.train = train

        self.samples = []
        for class_name in classes:
            class_dir = os.path.join(root, class_name)
            if not os.path.isdir(class_dir):
                continue
            for fname in os.listdir(class_dir):
                if fname.lower().endswith((".avi", ".mp4")):
                    self.samples.append((os.path.join(class_dir, fname), self.class_to_idx[class_name]))

        if not self.samples:
            raise RuntimeError(
                f"No video files found under {root}. Did you run data/download_ucf101.py first?"
            )

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        clip = load_clip(path, self.num_frames, self.frame_size, self.train)  # (T, H, W, C)

        if self.train:
            if random.random() < 0.5:
                clip = clip[:, :, ::-1, :]  # horizontal flip
            clip = self._random_crop_resize(clip)

        clip = clip.astype(np.float32) / 255.0
        clip = (clip - MEAN) / STD
        clip = torch.from_numpy(clip.copy()).permute(3, 0, 1, 2).float()  # (C, T, H, W)
        return clip, label

    def _random_crop_resize(self, clip: np.ndarray) -> np.ndarray:
        """Random crop to ~90% then resize back — a mild spatial augmentation."""
        t, h, w, c = clip.shape
        crop_h, crop_w = int(h * 0.9), int(w * 0.9)
        top = random.randint(0, h - crop_h)
        left = random.randint(0, w - crop_w)
        cropped = clip[:, top:top + crop_h, left:left + crop_w, :]
        resized = np.stack([cv2.resize(f, (w, h)) for f in cropped])
        return resized
