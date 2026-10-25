"""Groups text lines into blocks (the same rules ChoiGrab uses on the phone): pieces of one column
join, neighbouring columns or rows of one balloon join, and lines with a dark line between them (a
balloon's outline) stay apart. Boxes are (left, top, right, bottom) floats in page pixels."""

import math

import cv2
import numpy as np

Box = tuple[float, float, float, float]


def width(box: Box) -> float:
    return box[2] - box[0]


def height(box: Box) -> float:
    return box[3] - box[1]


def vertical(box: Box) -> bool:
    return height(box) > width(box) * 1.5


def union(a: Box, b: Box) -> Box:
    return min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])


def x_overlap(a: Box, b: Box) -> float:
    return min(a[2], b[2]) - max(a[0], b[0])


def y_overlap(a: Box, b: Box) -> float:
    return min(a[3], b[3]) - max(a[1], b[1])


def unclip(box: Box, ratio: float = 1.5) -> Box:
    """DB's growth: a detected (shrunk) line region grows by area * ratio / perimeter on every side."""
    grow = width(box) * height(box) * ratio / (2 * (width(box) + height(box)))

    return box[0] - grow, box[1] - grow, box[2] + grow, box[3] + grow


def core(box: Box) -> Box:
    """Undoes [unclip]: s = 2 * grow solves 3.5 s² - 2.5 s (W + H) + 1.5 W H = 0."""
    total = width(box) + height(box)
    root = 6.25 * total * total - 21 * width(box) * height(box)
    shrink = 0.0 if root < 0 else (2.5 * total - math.sqrt(root)) / 7
    side = max(0.0, min(shrink / 2, min(width(box), height(box)) / 2 - 1))

    return box[0] + side, box[1] + side, box[2] - side, box[3] - side


def apart(gray: np.ndarray, a: Box, b: Box) -> bool:
    """True when the light page around the letters of a does not reach the letters of b. Only judged
    on light pages; on dark ones lines are never split this way."""
    left, top, right, bottom = (int(v) for v in union(a, b))
    left, top = max(0, left), max(0, top)
    right, bottom = min(gray.shape[1], right), min(gray.shape[0], bottom)
    region = gray[top:bottom, left:right]

    if region.size == 0:
        return False

    middle = float(np.median(region))

    if middle < 128:
        return False

    _, labels = cv2.connectedComponents((region > middle * 0.6).astype(np.uint8), connectivity=4)

    def labels_in(box: Box) -> set[int]:
        x1, y1, x2, y2 = core(box)
        area = labels[max(0, int(y1) - top) : max(0, int(y2) - top), max(0, int(x1) - left) : max(0, int(x2) - left)]

        return set(np.unique(area).tolist()) - {0}

    return not (labels_in(a) & labels_in(b))


def merge_columns(boxes: list[Box], gray: np.ndarray) -> list[Box]:
    """Vertical text often comes as pieces of a column (hand lettering has wide gaps): pieces in the
    same column, at most about one and a half characters apart and not divided, become one."""
    merged: list[Box] = []

    for box in sorted(boxes, key=lambda b: b[1]):
        wide = width(box) > height(box) * 2.5
        index = -1

        if not wide:
            for i, column in enumerate(merged):
                if (
                    width(column) <= height(column) * 2.5
                    and x_overlap(box, column) > 0.5 * min(width(box), width(column))
                    and box[1] - column[3] < 1.6 * max(width(box), width(column))
                    and not apart(gray, column, box)
                ):
                    index = i
                    break

        if index >= 0:
            merged[index] = union(merged[index], box)
        else:
            merged.append(box)

    return merged


def together(a: Box, b: Box) -> bool:
    gap = lambda s1, e1, s2, e2: max(s1, s2) - min(e1, e2)

    if vertical(a) and vertical(b):
        return y_overlap(a, b) > 0.4 * min(height(a), height(b)) and gap(a[0], a[2], b[0], b[2]) < 0.9 * max(width(a), width(b))

    if not vertical(a) and not vertical(b):
        return x_overlap(a, b) > 0.3 * min(width(a), width(b)) and gap(a[1], a[3], b[1], b[3]) < 0.9 * max(height(a), height(b))

    return False


def group(lines: list[Box], gray: np.ndarray) -> list[list[Box]]:
    """Lines that read as one text (one balloon or caption)."""
    joins = lambda a, b: together(a, b) and not apart(gray, a, b)
    groups: list[list[Box]] = []

    for line in lines:
        home = next((members for members in groups if any(joins(m, line) for m in members)), None)

        if home is None:
            groups.append([line])
        else:
            home.append(line)

    changed = True

    while changed:
        changed = False

        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                if any(joins(a, b) for a in groups[i] for b in groups[j]):
                    groups[i] += groups.pop(j)
                    changed = True
                    break

            if changed:
                break

    return groups


def reading_order(boxes: list[Box]) -> list[int]:
    """Manga order: rows of blocks top to bottom (a row = blocks overlapping in height), each row
    right to left."""
    order = sorted(range(len(boxes)), key=lambda i: boxes[i][1])
    rows: list[list[int]] = []

    for i in order:
        row = next((r for r in rows if any(y_overlap(boxes[i], boxes[j]) > 0.5 * min(height(boxes[i]), height(boxes[j])) for j in r)), None)

        if row is None:
            rows.append([i])
        else:
            row.append(i)

    return [i for row in rows for i in sorted(row, key=lambda k: -boxes[k][2])]
