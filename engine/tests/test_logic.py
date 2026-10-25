import numpy as np
from PIL import ImageFont

from choimanga import layout
from choimanga.pipeline import worth_translating
from choimanga.translate import parse_numbered
from choimanga.typeset import DEFAULT_FONT, balloon_area, fit, wrap


def test_numbered_reply_comes_back_in_order():
    assert parse_numbered("1. 다녀왔어\n2. 여보?\n", 2) == ["다녀왔어", "여보?"]
    assert parse_numbered("2) 여보?\n1) 다녀왔어", 2) == ["다녀왔어", "여보?"]


def test_numbered_reply_with_missing_or_repeated_numbers_is_refused():
    assert parse_numbered("1. 다녀왔어", 2) is None
    assert parse_numbered("1. a\n1. b", 2) is None
    assert parse_numbered("1. a\n3. b", 2) is None


def test_lone_stroke_read_as_a_letter_is_not_translated():
    assert not worth_translating("と", 0.0)
    assert worth_translating("と", 0.8)
    assert worth_translating("ただいま", 0.0)
    assert not worth_translating("...", 0.9)


def test_core_undoes_unclip():
    box = (100.0, 10.0, 126.0, 104.0)
    back = layout.core(layout.unclip(box))

    assert all(abs(a - b) < 0.5 for a, b in zip(back, box))


def test_outline_between_columns_keeps_balloons_apart():
    gray = np.full((60, 80), 230, np.uint8)
    left, right = (5.0, 5.0, 30.0, 55.0), (45.0, 5.0, 70.0, 55.0)

    assert not layout.apart(gray, left, right)
    gray[:, 38] = 10
    assert layout.apart(gray, left, right)


def test_reading_order_is_right_to_left_then_down():
    boxes = [(10.0, 10.0, 40.0, 80.0), (60.0, 12.0, 90.0, 80.0), (30.0, 200.0, 60.0, 260.0)]

    assert layout.reading_order(boxes) == [1, 0, 2]


def test_wrap_keeps_words_and_never_starts_a_line_with_punctuation():
    font = ImageFont.truetype(DEFAULT_FONT, 20)
    lines = wrap("잠깐만, 어디 가는 거야?", font, font.getlength("잠깐만, 어디"), split_words=False)

    assert lines == ["잠깐만, 어디", "가는 거야?"]
    assert wrap("다녀왔습니다", font, 30, split_words=False) is None
    assert all(line[0] not in ",.?!" for line in wrap("다녀왔습니다?!", font, 30, split_words=True))


def test_fit_never_writes_larger_than_the_japanese_letters():
    font, lines = fit("네", DEFAULT_FONT, (0, 0, 400, 400), 1.0, letter=30)

    assert font.size <= 32 and lines == ["네"]


def test_balloon_area_reaches_the_outline_of_a_plain_balloon():
    page = np.full((200, 200, 3), 240, np.uint8)
    page[20, 20:180] = page[180, 20:180] = 0
    page[20:180, 20] = page[20:180, 180] = 0
    area = balloon_area(page, (90, 60, 110, 140))

    assert area[0] < 40 and area[2] > 160
    assert 20 < area[0] and area[2] < 180
