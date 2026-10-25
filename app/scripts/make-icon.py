"""앱 아이콘 원본(1024px)을 그린다. TDS 파랑 바탕에 흰 말풍선 두 개: 뒤 작은 풍선에 あ, 앞 큰 풍선에 한."""
import sys
from PIL import Image, ImageDraw, ImageFont

S = 1024
SCALE = 4
big = S * SCALE
img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
blue = (49, 130, 246, 255)


def v(*values):
    return [value * SCALE for value in values]


def font(path, size):
    return ImageFont.truetype(path, size * SCALE)


d.rounded_rectangle(v(64, 64, 960, 960), radius=230 * SCALE, fill=blue)

# 뒤 풍선(あ): 오른쪽 위, 조금 비치는 흰색. 꼬리는 오른쪽 아래.
back = Image.new("RGBA", (big, big), (0, 0, 0, 0))
b = ImageDraw.Draw(back)
b.rounded_rectangle(v(470, 190, 840, 500), radius=120 * SCALE, fill=(255, 255, 255, 150))
b.polygon(v(720, 470, 800, 470, 830, 570), fill=(255, 255, 255, 150))
b.text(v(655, 345), "あ", font=font(r"C:\Windows\Fonts\YuGothB.ttc", 190), fill=blue, anchor="mm")
img.alpha_composite(back)

# 앞 풍선(한): 왼쪽 아래, 흰색. 꼬리는 왼쪽 아래.
d.rounded_rectangle(v(170, 380, 650, 780), radius=150 * SCALE, fill=(255, 255, 255, 255))
d.polygon(v(250, 730, 360, 740, 200, 860), fill=(255, 255, 255, 255))
d.text(v(410, 580), "한", font=font(r"C:\Windows\Fonts\malgunbd.ttf", 270), fill=blue, anchor="mm")

img.resize((S, S), Image.LANCZOS).save(sys.argv[1])
