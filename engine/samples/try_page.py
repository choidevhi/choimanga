import os, sys, time, faulthandler
faulthandler.dump_traceback_later(60, exit=True)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["HF_HOME"] = "models/hf"
from choimanga.pipeline import Engine, Options
e = Engine("models")
for name in sys.argv[1:]:
    t = time.time(); marks = []
    page = e.process("samples/" + name, "samples/out/" + name, Options(), lambda s: marks.append((s, round(time.time() - t, 2))))
    print(name, marks, flush=True) if False else print(name, marks, f"total {time.time()-t:.1f}s")
    for line in page.lines: print("  ", line.box, line.japanese, "->", line.korean)
