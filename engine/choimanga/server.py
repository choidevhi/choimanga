"""The engine process the app starts: one JSON request per line on stdin, JSON replies and progress
on stdout (logs go to stderr). No network port; only Ollama on 127.0.0.1 is called.

Requests: {"id", "cmd": "status" | "fonts" | "process" | "retypeset" | "shutdown", ...}
  process:   {"source", "output", "options": {"model", "font", "scale"}}
  retypeset: {"output", "korean": [...] | null, "options": {...}}
Replies:   {"id", "ok": true, "data": ...} or {"id", "ok": false, "error": "..."}
Progress:  {"id", "event": "step", "step": "detect" | "ocr" | "translate" | "erase" | "typeset"}"""

import json
import os
import sys
import traceback
from dataclasses import asdict

ENGINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ENGINE, "models")
os.environ.setdefault("HF_HOME", os.path.join(MODELS, "hf"))
# The model files are local; never ask the hub.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

from . import fonts, translate  # noqa: E402
from .pipeline import Engine, Options, retypeset  # noqa: E402


def options(raw: dict | None) -> Options:
    raw = raw or {}
    defaults = Options()

    return Options(model=raw.get("model") or defaults.model, font=raw.get("font") or defaults.font, scale=float(raw.get("scale") or defaults.scale))


def status(engine: Engine) -> dict:
    import torch

    data = {"device": engine.device, "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None, "models": [], "ollama": None}

    try:
        data["models"] = translate.models()
    except OSError as error:
        data["ollama"] = str(error)

    return data


def main() -> None:
    out = sys.stdout
    # Replies only on the real stdout; anything libraries print goes to stderr.
    sys.stdout = sys.stderr
    engine = Engine(MODELS)

    def send(message: dict) -> None:
        out.write(json.dumps(message, ensure_ascii=False) + "\n")
        out.flush()

    send({"event": "ready"})

    for raw in sys.stdin:
        if not raw.strip():
            continue

        request = json.loads(raw)
        ident = request.get("id")
        cmd = request.get("cmd")

        try:
            if cmd == "shutdown":
                send({"id": ident, "ok": True, "data": None})
                break

            if cmd == "status":
                data = status(engine)
            elif cmd == "fonts":
                data = fonts.korean_fonts()
            elif cmd == "process":
                step = lambda name: send({"id": ident, "event": "step", "step": name})
                data = asdict(engine.process(request["source"], request["output"], options(request.get("options")), step))
            elif cmd == "retypeset":
                data = asdict(retypeset(request["output"], request.get("korean"), options(request.get("options"))))
            else:
                raise ValueError(f"unknown command: {cmd}")

            send({"id": ident, "ok": True, "data": data})
        except Exception as error:  # noqa: BLE001 - every failure goes back to the app as a reply
            traceback.print_exc()
            send({"id": ident, "ok": False, "error": f"{type(error).__name__}: {error}"})


if __name__ == "__main__":
    main()
