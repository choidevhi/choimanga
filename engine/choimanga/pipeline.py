"""One page: find the text, read it, translate it, erase it, write the Korean. What it found and the
cleaned page are kept next to the output (.choimanga/<name>.json and .clean.png), so changing a
translation or the letter size later only writes the text again."""

import json
import os
import re
from collections.abc import Callable
from dataclasses import asdict, dataclass

import numpy as np
import torch
from PIL import Image

from .detect import Detector
from .inpaint import Lama
from .ocr import MangaOcr
from .translate import Translator
from .typeset import DEFAULT_FONT, Placement, render

JAPANESE = re.compile("[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ々〆]")
WORK = ".choimanga"


@dataclass
class Line:
    box: tuple[int, int, int, int]
    vertical: bool
    japanese: str
    korean: str
    letter: float = 0.0


@dataclass
class Page:
    source: str
    output: str
    width: int
    height: int
    lines: list[Line]


@dataclass
class Options:
    model: str = "ko-edit"
    font: str = DEFAULT_FONT
    scale: float = 0.92


def worth_translating(text: str, score: float) -> bool:
    """Japanese to translate: two or more kana/kanji, or one inside a block the block head found
    (a lone stroke of art read as a letter has neither)."""
    count = len(JAPANESE.findall(text))

    return count >= 2 or (count == 1 and score > 0)


def work_paths(output: str) -> tuple[str, str]:
    folder = os.path.join(os.path.dirname(output), WORK)
    name = os.path.splitext(os.path.basename(output))[0]

    return os.path.join(folder, name + ".json"), os.path.join(folder, name + ".clean.png")


class Engine:
    def __init__(self, models: str):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.models = models
        self._detector: Detector | None = None
        self._ocr: MangaOcr | None = None
        self._lama: Lama | None = None

    def load(self) -> None:
        if self._detector is None:
            self._detector = Detector(os.path.join(self.models, "comictextdetector.pt.onnx"))
            self._ocr = MangaOcr(self.device)
            self._lama = Lama(os.path.join(self.models, "big-lama.pt"), self.device)

    def process(self, source: str, output: str, options: Options, step: Callable[[str], None]) -> Page:
        self.load()
        image = np.asarray(Image.open(source).convert("RGB"))
        height, width = image.shape[:2]
        step("detect")
        found = self._detector.detect(image)
        step("ocr")
        texts = self._ocr.read([Image.fromarray(image).crop(block.box) for block in found.blocks])
        kept = [(block, text) for block, text in zip(found.blocks, texts) if worth_translating(text, block.score)]
        order = reading_order([block.box for block, _ in kept])
        kept = [kept[i] for i in order]
        step("translate")
        korean = Translator(options.model).translate([text for _, text in kept])
        step("erase")
        # Only the letters of the blocks being replaced go; other text (signs left as they are) stays.
        mask = np.zeros_like(found.mask)

        for block, _ in kept:
            grow_x, grow_y = int(block.width * 0.3) + 4, int(block.height * 0.3) + 4
            y1, y2 = max(0, block.top - grow_y), min(height, block.bottom + grow_y)
            x1, x2 = max(0, block.left - grow_x), min(width, block.right + grow_x)
            mask[y1:y2, x1:x2] = found.mask[y1:y2, x1:x2]

        clean = self._lama.erase(image, mask, [block.box for block, _ in kept])
        page = Page(source, output, width, height, [Line(block.box, block.vertical, text, ko, block.letter) for (block, text), ko in zip(kept, korean)])
        json_path, clean_path = work_paths(output)
        os.makedirs(os.path.dirname(json_path), exist_ok=True)
        Image.fromarray(clean).save(clean_path)
        step("typeset")
        write_page(page, clean, options)
        save(page, json_path)

        return page


def reading_order(boxes: list[tuple[int, int, int, int]]) -> list[int]:
    from .layout import reading_order as order

    return order([tuple(float(v) for v in box) for box in boxes])


def write_page(page: Page, clean: np.ndarray, options: Options) -> None:
    out = render(clean, [Placement(line.box, line.korean, line.letter) for line in page.lines], options.font, options.scale)
    extension = os.path.splitext(page.output)[1].lower()
    os.makedirs(os.path.dirname(page.output) or ".", exist_ok=True)

    if extension in (".jpg", ".jpeg"):
        out.save(page.output, quality=95)
    elif extension == ".webp":
        out.save(page.output, quality=95)
    else:
        out.save(page.output)


def save(page: Page, path: str) -> None:
    with open(path, "w", encoding="utf-8") as file:
        json.dump(asdict(page), file, ensure_ascii=False, indent=1)


def load(path: str) -> Page:
    with open(path, encoding="utf-8") as file:
        data = json.load(file)

    return Page(**{**data, "lines": [Line(**{**line, "box": tuple(line["box"])}) for line in data["lines"]]})


def retypeset(output: str, korean: list[str] | None, options: Options) -> Page:
    """Writes the page again from its cleaned copy: new translations (same order) and/or new size or font."""
    json_path, clean_path = work_paths(output)
    page = load(json_path)

    if korean is not None:
        page.lines = [Line(line.box, line.vertical, line.japanese, text, line.letter) for line, text in zip(page.lines, korean)]

    write_page(page, np.asarray(Image.open(clean_path).convert("RGB")), options)
    save(page, json_path)

    return page
