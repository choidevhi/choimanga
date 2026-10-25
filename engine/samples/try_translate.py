import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from choimanga.translate import Translator
lines = ["ただいま", "あなた？", "ちょっと待ってどこへ行くの", "その夜、町は静かだった。", "お腹がすいた…ご飯を食べよう", "うるせえ！てめえには関係ねえだろ！"]
for model in sys.argv[1:]:
    t = time.time(); out = Translator(model).translate(lines)
    print(model, f"{time.time()-t:.1f}s")
    for a, b in zip(lines, out): print("  ", a, "->", b)
