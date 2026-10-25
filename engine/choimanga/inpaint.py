"""Removes the Japanese with LaMa (big-lama, TorchScript): the letters' place is filled with what
the picture around it suggests (balloon white, screentone, art), not a flat colour."""

import cv2
import numpy as np
import torch

# Each text block is inpainted in a window this much larger than the block, at most this size.
MARGIN = 0.6
MAX_SIDE = 1024


class Lama:
    def __init__(self, path: str, device: str):
        self.device = device
        self.model = torch.jit.load(path, map_location=device).eval()

    @torch.inference_mode()
    def _run(self, image: np.ndarray, mask: np.ndarray) -> np.ndarray:
        """image HxWx3 uint8, mask HxW bool -> HxWx3 uint8 (sides padded to multiples of 8)."""
        height, width = mask.shape
        pad_h = (8 - height % 8) % 8
        pad_w = (8 - width % 8) % 8
        image = np.pad(image, ((0, pad_h), (0, pad_w), (0, 0)), mode="reflect")
        mask = np.pad(mask, ((0, pad_h), (0, pad_w)), mode="constant")
        tensor = torch.from_numpy(image).permute(2, 0, 1)[None].float().div(255).to(self.device)
        holes = torch.from_numpy(mask.astype(np.float32))[None, None].to(self.device)
        out = self.model(tensor, holes)[0].permute(1, 2, 0).clamp(0, 1).mul(255).byte().cpu().numpy()

        return out[:height, :width]

    def erase(self, image: np.ndarray, mask: np.ndarray, boxes: list[tuple[int, int, int, int]]) -> np.ndarray:
        """Inpaints the masked pixels around each box, window by window, and returns a new image."""
        out = image.copy()
        height, width = mask.shape

        for left, top, right, bottom in boxes:
            grow_x = int((right - left) * MARGIN) + 16
            grow_y = int((bottom - top) * MARGIN) + 16
            x1, y1 = max(0, left - grow_x), max(0, top - grow_y)
            x2, y2 = min(width, right + grow_x), min(height, bottom + grow_y)
            holes = mask[y1:y2, x1:x2]

            if not holes.any():
                continue

            window = out[y1:y2, x1:x2]
            # Letters on a plain balloon: its own colour fills them exactly (LaMa leaves faint ghosts there).
            ring = cv2.dilate(holes.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
            ring &= ~holes
            around = window[ring]

            if len(around) and around.std(axis=0).max() < 6:
                window[holes] = np.median(around, axis=0).astype(np.uint8)
                continue

            scale = min(1.0, MAX_SIDE / max(window.shape[:2]))
            small = window if scale == 1.0 else cv2.resize(window, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            small_holes = holes if scale == 1.0 else cv2.resize(holes.astype(np.uint8), (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
            filled = self._run(small, small_holes)

            if scale != 1.0:
                filled = cv2.resize(filled, (window.shape[1], window.shape[0]), interpolation=cv2.INTER_CUBIC)

            # Only the holes change; every other pixel stays the original.
            window[holes] = filled[holes]

        return out
