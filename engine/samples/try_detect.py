import os, sys, time
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["HF_HOME"] = "models/hf"
from choimanga.detect import Detector
from choimanga.ocr import MangaOcr
d = Detector("models/comictextdetector.pt.onnx")
ocr = MangaOcr("cuda")
for name in sys.argv[1:]:
    img = np.asarray(Image.open("samples/" + name).convert("RGB"))
    t = time.time(); r = d.detect(img); t1 = time.time() - t
    texts = ocr.read([Image.fromarray(img).crop(b.box) for b in r.blocks])
    print(name, f"detect {t1:.2f}s ocr {time.time()-t-t1:.2f}s")
    for b, text in zip(r.blocks, texts):
        print("  ", b.box, round(b.score, 2), "V" if b.vertical else "H", text.encode("unicode_escape").decode())
    ov = img.copy(); ov[r.mask] = [255, 0, 0]
    vis = Image.fromarray(ov); dr = ImageDraw.Draw(vis)
    for b in r.blocks: dr.rectangle(b.box, outline=(0, 160, 255), width=2)
    vis.save("samples/det_" + name.rsplit(".", 1)[0] + ".png")
