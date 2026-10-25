"""Installed fonts that can write Korean (the system's and the user's own), for the font picker."""

import os

from fontTools.ttLib import TTCollection, TTFont

FOLDERS = [os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts"), os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Windows", "Fonts")]
# 한, 글, 가: a font without these cannot write the translation.
NEEDED = [0xD55C, 0xAE00, 0xAC00]


def _name(font: TTFont) -> str:
    table = font["name"]

    for platform, language in ((3, 0x412), (3, 0x409)):
        record = table.getName(4, platform, 1, language)

        if record:
            return str(record)

    return ""


def korean_fonts() -> list[dict]:
    found = []

    for folder in FOLDERS:
        if not os.path.isdir(folder):
            continue

        for file in sorted(os.listdir(folder)):
            path = os.path.join(folder, file)
            extension = file.lower().rsplit(".", 1)[-1]

            if extension not in ("ttf", "otf", "ttc"):
                continue

            try:
                # Only the first face of a collection: Pillow opens index 0 by default.
                font = TTCollection(path, lazy=True).fonts[0] if extension == "ttc" else TTFont(path, lazy=True)
                cmap = font.getBestCmap() or {}

                if all(code in cmap for code in NEEDED):
                    found.append({"path": path, "name": _name(font) or file})
            except Exception:  # noqa: BLE001 - a broken font file is skipped
                continue

    return sorted(found, key=lambda item: item["name"])
