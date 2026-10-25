"""Writes the Korean into the cleaned page. Each block's text goes into its balloon: the light region
around the block on the cleaned page (when it is a closed balloon, not the open page), shrunk to the
rectangle an oval can hold. Letters are as large as fit, times the chosen scale, black with a white
outline so they stay readable where they run onto art."""

from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

DEFAULT_FONT = r"C:\Windows\Fonts\malgunbd.ttf"
LINE_SPACING = 1.12
MIN_SIZE = 9


@dataclass
class Placement:
    box: tuple[int, int, int, int]
    text: str
    letter: float = 0.0


def balloon_area(clean: np.ndarray, box: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    """Where the Korean may go: inside the balloon around the block. Along each row (and column)
    through the block's middle, the light run from the centre reaches the outline on both sides;
    the area takes a width most rows allow, so a tail or a slanted outline crossing a few rows does
    not shrink it. On art (no light balloon) or an open page it stays near the block."""
    height, width = clean.shape[:2]
    left, top, right, bottom = box
    gray = cv2.cvtColor(clean, cv2.COLOR_RGB2GRAY)
    inside = gray[top:bottom, left:right]

    if inside.size == 0 or np.median(inside) < 150:
        return grow_for_korean(box, width, height)

    # Light page; outlines thickened a little so a 2 px gap does not let a run escape.
    dark = cv2.dilate((gray <= np.median(inside) - 45).astype(np.uint8), np.ones((3, 3), np.uint8))
    # How far a balloon may reach past its text: a lone narrow column can sit in a wide balloon.
    reach_x = max((right - left) * 2, (bottom - top) * 1.2) + 10
    reach_y = max(bottom - top, (right - left) * 1.2) + 10
    cx, cy = (left + right) // 2, (top + bottom) // 2

    def runs(lines: range, along_x: bool) -> list[tuple[int, int, bool]]:
        found = []

        for at in lines:
            row = dark[at, :] if along_x else dark[:, at]
            start = cx if along_x else cy
            low_limit = max(0, int((left if along_x else top) - (reach_x if along_x else reach_y)))
            high_limit = min(width if along_x else height, int((right if along_x else bottom) + (reach_x if along_x else reach_y)))
            low = start
            high = start

            while low > low_limit and not row[low - 1]:
                low -= 1

            while high < high_limit - 1 and not row[high + 1]:
                high += 1

            found.append((low, high, low == low_limit or high == high_limit - 1))

        return found

    middle_rows = range(top + (bottom - top) // 5, bottom - (bottom - top) // 5)
    middle_cols = range(left + (right - left) // 5, right - (right - left) // 5)
    rows, cols = runs(middle_rows, True), runs(middle_cols, False)

    if not rows or not cols or sum(r[2] for r in rows) > 0.4 * len(rows) or sum(c[2] for c in cols) > 0.4 * len(cols):
        return grow_for_korean(box, width, height)

    x1 = float(np.percentile([r[0] for r in rows], 60))
    x2 = float(np.percentile([r[1] for r in rows], 40))
    y1 = float(np.percentile([c[0] for c in cols], 60))
    y2 = float(np.percentile([c[1] for c in cols], 40))
    pad_x, pad_y = (x2 - x1) * 0.07, (y2 - y1) * 0.07
    area = (int(x1 + pad_x), int(y1 + pad_y), int(x2 - pad_x), int(y2 - pad_y))

    return min(area[0], left), min(area[1], top), max(area[2], right), max(area[3], bottom)


def grow_for_korean(box: tuple[int, int, int, int], width: int, height: int) -> tuple[int, int, int, int]:
    """A narrow vertical column gets room for Korean rows (0.45 of its height), staying on the page."""
    left, top, right, bottom = box

    if right - left >= (bottom - top) * 0.45:
        return box

    half = (bottom - top) * 0.45 / 2
    centre = min(max((left + right) / 2, half), width - half)

    return int(centre - half), top, int(centre + half), bottom


PUNCTUATION = set(",.?!…~)」』」-、。！？")


def wrap(text: str, font: ImageFont.FreeTypeFont, width: float, split_words: bool) -> list[str] | None:
    """Breaks at spaces. A word wider than the line breaks between syllables only when split_words;
    otherwise there is no wrapping (None). A line never starts with punctuation."""
    lines: list[str] = []
    current = ""

    for word in text.split():
        candidate = f"{current} {word}".strip()

        if font.getlength(candidate) <= width:
            current = candidate
            continue

        if current:
            lines.append(current)
            current = ""

        if font.getlength(word) <= width:
            current = word
            continue

        if not split_words:
            return None

        for char in word:
            if not current or font.getlength(current + char) <= width or char in PUNCTUATION:
                current += char
            else:
                lines.append(current)
                current = char

    if current:
        lines.append(current)

    return lines


def fit(text: str, font_path: str, area: tuple[int, int, int, int], scale: float, letter: float) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """The largest size (no larger than the Japanese letters) whose wrapped text fits the area,
    keeping words whole when any size allows it; then times scale."""
    width, height = area[2] - area[0], area[3] - area[1]
    cap = min(height, 120, letter * 1.05 if letter > 0 else width * 0.5)

    def largest(split_words: bool) -> int | None:
        # Whole pixel sizes only: with a fractional bound the halving can stop moving.
        low, high = MIN_SIZE - 1, max(MIN_SIZE, int(cap)) + 1

        while high - low > 1:
            size = (low + high) // 2
            font = ImageFont.truetype(font_path, size)
            lines = wrap(text, font, width, split_words)
            fits = lines is not None and len(lines) * size * LINE_SPACING <= height and max(font.getlength(line) for line in lines) <= width

            if fits:
                low = size
            else:
                high = size

        return low if low >= MIN_SIZE else None

    whole = largest(False)
    split = largest(True) or MIN_SIZE
    # Whole words unless that makes the letters much smaller (a narrow balloon and a long word).
    keep_words = whole is not None and whole >= split * 0.7
    size = whole if keep_words else split
    font = ImageFont.truetype(font_path, max(MIN_SIZE, round(size * scale)))
    lines = wrap(text, font, width, False) if keep_words else None

    return font, lines or wrap(text, font, width, True) or [text]


def render(clean: np.ndarray, placements: list[Placement], font_path: str = DEFAULT_FONT, scale: float = 0.92) -> Image.Image:
    page = Image.fromarray(clean)
    draw = ImageDraw.Draw(page)

    for placement in placements:
        text = placement.text.strip()

        if not text:
            continue

        area = balloon_area(clean, placement.box)
        font, lines = fit(text, font_path, area, scale, placement.letter)
        size = font.size
        step = size * LINE_SPACING
        top = (area[1] + area[3]) / 2 - step * len(lines) / 2 + (step - size) / 2
        stroke = max(2, round(size * 0.12))

        for index, line in enumerate(lines):
            draw.text(((area[0] + area[2]) / 2, top + index * step), line, font=font, fill=(17, 17, 17), anchor="mt", stroke_width=stroke, stroke_fill=(255, 255, 255))

    return page
