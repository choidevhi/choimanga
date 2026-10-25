"""Finds text in a manga page with comic-text-detector (ONNX): text blocks (YOLO head), a text pixel
mask (segmentation head) and text line probabilities (DB head)."""

from dataclasses import dataclass
from functools import reduce

import cv2
import numpy as np
import onnxruntime as ort

from . import layout

SIDE = 1024
CONF = 0.4
NMS = 0.35
MASK_THRESHOLD = 0.3
LINE_THRESHOLD = 0.3


@dataclass
class Block:
    left: int
    top: int
    right: int
    bottom: int
    score: float
    vertical: bool
    # The Japanese letters' size (a column's width, a row's height): the Korean is not written larger.
    letter: float = 0.0

    @property
    def box(self) -> tuple[int, int, int, int]:
        return self.left, self.top, self.right, self.bottom

    @property
    def width(self) -> int:
        return self.right - self.left

    @property
    def height(self) -> int:
        return self.bottom - self.top


@dataclass
class Detection:
    blocks: list[Block]
    # Text pixels (HxW bool, page size): what inpainting removes.
    mask: np.ndarray


class Detector:
    def __init__(self, path: str):
        self.session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])

    def detect(self, page: np.ndarray) -> Detection:
        """page: HxWx3 RGB uint8. A long strip (webtoon, a column of 4 panels) is read in overlapping
        pieces about 1.5 times as tall as wide; shrunk whole to 1024 its letters would be too small."""
        height, width = page.shape[:2]

        if height <= width * 2:
            return self._detect(page)

        tile = int(width * 1.5)
        step = int(tile * 0.75)
        tops = list(range(0, height - tile, step)) + [height - tile]
        blocks: list[Block] = []
        mask = np.zeros((height, width), bool)

        for top in tops:
            part = self._detect(page[top : top + tile])
            mask[top : top + tile] |= part.mask

            for block in part.blocks:
                moved = Block(block.left, block.top + top, block.right, block.bottom + top, block.score, block.vertical, block.letter)
                cut = (block.top <= 1 and top > 0) or (block.bottom >= tile - 1 and top + tile < height)

                # A block cut by the piece's edge is found whole in the next piece.
                if not cut and not covered(moved.box, blocks):
                    blocks.append(moved)

        return Detection(blocks, mask)

    def _detect(self, page: np.ndarray) -> Detection:
        height, width = page.shape[:2]
        scale = SIDE / max(height, width)
        resized = cv2.resize(page, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
        # The model was trained on pages padded at the right and bottom only.
        padded = np.zeros((SIDE, SIDE, 3), np.uint8)
        padded[: resized.shape[0], : resized.shape[1]] = resized
        tensor = padded.transpose(2, 0, 1)[None].astype(np.float32) / 255
        blk, seg, det = self.session.run(None, {"images": tensor})
        used = (resized.shape[0], resized.shape[1])
        lines = det[0, 0, : used[0], : used[1]] > LINE_THRESHOLD
        mask = cv2.resize((seg[0, 0, : used[0], : used[1]] > MASK_THRESHOLD).astype(np.uint8), (width, height), interpolation=cv2.INTER_NEAREST) > 0
        gray = cv2.cvtColor(page, cv2.COLOR_RGB2GRAY)
        found = [Block(*clip(box, width, height), float(score), is_vertical(lines, scale, clip(box, width, height))) for *box, score in yolo_boxes(blk[0], scale)]
        blocks = [block for block in found if block.width >= 4 and block.height >= 4]
        columns = layout.merge_columns(line_boxes(lines, scale), gray)

        # The block head misses some text (old or hand-lettered pages); lines it missed are grouped here.
        for members in layout.group(columns, gray):
            box = clip(members[0] if len(members) == 1 else reduce(layout.union, members), width, height)

            if covered(box, blocks) or box[2] - box[0] < 6 or box[3] - box[1] < 6:
                continue

            blocks.append(Block(*box, 0.0, bool(sum(layout.vertical(m) for m in members) * 2 >= len(members))))

        for block in blocks:
            block.letter = letter_size(block, columns)

        return Detection(blocks, text_mask(mask, blocks) | letter_mask(gray, blocks))


def clip(box, width: int, height: int) -> tuple[int, int, int, int]:
    return max(0, int(box[0])), max(0, int(box[1])), min(width, int(box[2])), min(height, int(box[3]))


def line_boxes(lines: np.ndarray, scale: float) -> list[layout.Box]:
    """Text line regions of the DB head, grown back to the letters' size, in page pixels."""
    count, _, stats, _ = cv2.connectedComponentsWithStats(lines.astype(np.uint8), connectivity=4)
    boxes = []

    for i in range(1, count):
        x, y, w, h, area = stats[i]

        if area < 10:
            continue

        boxes.append(tuple(v / scale for v in layout.unclip((x, y, x + w, y + h))))

    return boxes


def covered(box: tuple[int, int, int, int], blocks: list[Block]) -> bool:
    """Mostly inside a block already found."""
    area = max(1, (box[2] - box[0]) * (box[3] - box[1]))

    for block in blocks:
        shared = max(0, min(box[2], block.right) - max(box[0], block.left)) * max(0, min(box[3], block.bottom) - max(box[1], block.top))

        if shared > 0.5 * area:
            return True

    return False


def yolo_boxes(raw: np.ndarray, scale: float) -> list[tuple[float, float, float, float, float]]:
    """YOLOv5 output rows (cx, cy, w, h, objectness, class scores...) -> page boxes after NMS."""
    scores = raw[:, 4] * raw[:, 5:].max(axis=1)
    keep = scores > CONF
    rows = raw[keep]
    scores = scores[keep]

    if not len(rows):
        return []

    xyxy = np.stack([rows[:, 0] - rows[:, 2] / 2, rows[:, 1] - rows[:, 3] / 2, rows[:, 0] + rows[:, 2] / 2, rows[:, 1] + rows[:, 3] / 2], axis=1)
    chosen = cv2.dnn.NMSBoxes([[float(x1), float(y1), float(x2 - x1), float(y2 - y1)] for x1, y1, x2, y2 in xyxy], scores.tolist(), CONF, NMS)

    return [(*(xyxy[i] / scale), scores[i]) for i in np.array(chosen).reshape(-1)]


def is_vertical(lines: np.ndarray, scale: float, box: tuple[int, int, int, int]) -> bool:
    """Japanese written top to bottom: the block's text lines (DB head) are mostly taller than wide."""
    left, top, right, bottom = (int(v * scale) for v in box)
    region = lines[top:bottom, left:right].astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(region, connectivity=8)
    tall = wide = 0

    for index in range(1, count):
        w, h, area = stats[index, cv2.CC_STAT_WIDTH], stats[index, cv2.CC_STAT_HEIGHT], stats[index, cv2.CC_STAT_AREA]

        if area < 12:
            continue

        if h > w * 1.2:
            tall += area
        elif w > h * 1.2:
            wide += area

    if tall == wide:
        return bool(box[3] - box[1] > (box[2] - box[0]) * 1.3)

    return bool(tall > wide)


def letter_size(block: Block, lines: list[layout.Box]) -> float:
    """The median thickness of the text lines inside the block. DB's line regions are shrunk text;
    grown back (unclip) they are about 1.15 times the letters (measured on 40 px Yu Gothic)."""
    inside = [line for line in lines if block.left <= (line[0] + line[2]) / 2 <= block.right and block.top <= (line[1] + line[3]) / 2 <= block.bottom]
    sizes = sorted(min(layout.width(line), layout.height(line)) for line in inside)

    if sizes:
        return float(sizes[len(sizes) // 2]) / 1.15

    return float(min(block.width, block.height))


def letter_mask(gray: np.ndarray, blocks: list[Block]) -> np.ndarray:
    """Whole dark strokes that touch a block's letters: hand lettering the segmentation head only
    partly marks. A stroke larger than the letters (a balloon's outline, art) is left alone."""
    height, width = gray.shape
    out = np.zeros(gray.shape, bool)

    for block in blocks:
        grow_x, grow_y = int(block.width * 0.3) + 4, int(block.height * 0.3) + 4
        x1, y1 = max(0, block.left - grow_x), max(0, block.top - grow_y)
        x2, y2 = min(width, block.right + grow_x), min(height, block.bottom + grow_y)
        window = gray[y1:y2, x1:x2]
        background = float(np.percentile(window, 80))

        # Dark letters on a light balloon only.
        if background < 150:
            continue

        dark = (window < background * 0.6).astype(np.uint8)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
        limit = max(block.letter, 8) * 1.6
        inner = labels[block.top - y1 : block.bottom - y1, block.left - x1 : block.right - x1]

        for index in set(np.unique(inner).tolist()) - {0}:
            x, y, w, h, _ = stats[index]
            # Strokes cut by the window edge or bigger than a letter belong to something else.
            if x == 0 or y == 0 or x + w == window.shape[1] or y + h == window.shape[0] or max(w, h) > limit:
                continue

            out[y1:y2, x1:x2] |= labels == index

    return cv2.dilate(out.astype(np.uint8), np.ones((5, 5), np.uint8), iterations=1) > 0


def text_mask(mask: np.ndarray, blocks: list[Block]) -> np.ndarray:
    """The segmentation mask inside the blocks (a little larger), grown so letter edges go too."""
    inside = np.zeros_like(mask)

    for block in blocks:
        grow = max(4, int(min(block.width, block.height) * 0.08))
        inside[max(0, block.top - grow) : block.bottom + grow, max(0, block.left - grow) : block.right + grow] = True

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))

    return cv2.dilate((mask & inside).astype(np.uint8), kernel, iterations=2) > 0
