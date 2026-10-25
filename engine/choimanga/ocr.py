"""Reads Japanese in a text block with manga-ocr (kha-white/manga-ocr-base), a model trained on
manga balloons: vertical and horizontal text, several lines, furigana, hand lettering."""

import re

import jaconv
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoTokenizer, VisionEncoderDecoderModel

MODEL = "kha-white/manga-ocr-base"


class MangaOcr:
    def __init__(self, device: str):
        self.device = device
        # Only the local copy (setup.ps1 put it in models\hf); the engine never goes online.
        self.processor = AutoImageProcessor.from_pretrained(MODEL, local_files_only=True)
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL, local_files_only=True)
        self.model = VisionEncoderDecoderModel.from_pretrained(MODEL, local_files_only=True).to(device).eval()

    @torch.inference_mode()
    def read(self, crops: list[Image.Image]) -> list[str]:
        if not crops:
            return []

        images = [crop.convert("L").convert("RGB") for crop in crops]
        pixels = self.processor(images, return_tensors="pt").pixel_values.to(self.device)
        ids = self.model.generate(pixels, max_length=300)

        return [tidy(self.tokenizer.decode(row, skip_special_tokens=True)) for row in ids]


def tidy(text: str) -> str:
    """manga-ocr's own clean-up: no spaces, ellipses as …, full-width ASCII."""
    text = "".join(text.split())
    text = text.replace("…", "...")
    text = re.sub("[・.]{2,}", lambda m: (m.end() - m.start()) * ".", text)

    return jaconv.h2z(text, ascii=True, digit=True)
