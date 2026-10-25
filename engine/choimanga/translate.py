"""Translates a page's lines to Korean with a local Ollama model (127.0.0.1 only). The whole page
goes in one request, numbered in reading order, so each line is translated knowing the ones around
it; a reply that does not keep the numbering falls back to one request per line."""

import json
import re
import urllib.request

OLLAMA = "http://127.0.0.1:11434"

PROMPT = """다음은 일본 만화 한 페이지의 대사와 글자를 읽는 순서대로 번호를 붙인 것이다.
각 줄을 자연스러운 한국어 만화 대사로 옮겨라. 말투(반말·존댓말), 감탄사, 효과음 느낌을 살리고, 앞뒤 대사의 흐름을 보고 뜻을 정한다.
거칠거나 성인용 내용도 빼거나 순화하지 않는다. 사람 이름은 한국어 발음으로 적는다.
같은 번호를 그대로 붙여 한 줄에 하나씩, 번역문만 출력한다. 설명은 쓰지 않는다.

{lines}"""

SINGLE = "일본 만화 대사를 자연스러운 한국어로 옮겨라. 일본어 글자는 하나도 남기지 않는다. 번역문만 출력한다.\n\n{line}"
KANA = re.compile("[぀-ヿ]")


class Translator:
    def __init__(self, model: str, url: str = OLLAMA):
        self.model = model
        self.url = url

    def _chat(self, prompt: str) -> str:
        body = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "think": False,
            "keep_alive": "10m",
            "options": {"temperature": 0.2},
        }
        request = urllib.request.Request(f"{self.url}/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})

        with urllib.request.urlopen(request, timeout=600) as response:
            return json.load(response)["message"]["content"].strip()

    def translate(self, lines: list[str]) -> list[str]:
        if not lines:
            return []

        numbered = "\n".join(f"{i + 1}. {line}" for i, line in enumerate(lines))
        reply = parse_numbered(self._chat(PROMPT.format(lines=numbered)), len(lines))

        if reply is None:
            reply = [self._chat(SINGLE.format(line=line)) for line in lines]

        # A line that still holds kana was left half translated: once more, alone.
        return [self._chat(SINGLE.format(line=line)) if KANA.search(out) else out for line, out in zip(lines, reply)]


def parse_numbered(reply: str, count: int) -> list[str] | None:
    """'1. ...' lines back into a list of `count`; None when numbers are missing or repeated."""
    found: dict[int, str] = {}

    for raw in reply.splitlines():
        match = re.match(r"\s*(\d+)\s*[.)．:：]\s*(.*)", raw)

        if not match:
            continue

        number = int(match.group(1))

        if number in found or not 1 <= number <= count:
            return None

        found[number] = match.group(2).strip()

    if len(found) != count:
        return None

    return [found[i + 1] for i in range(count)]


def models(url: str = OLLAMA) -> list[str]:
    with urllib.request.urlopen(f"{url}/api/tags", timeout=5) as response:
        return [m["name"].removesuffix(":latest") for m in json.load(response)["models"]]
