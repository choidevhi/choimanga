import { describe, expect, it } from "vitest";

import type { Line } from "./api";
import { boxStyle, changed, fileName, fit, koreanFor, samePath, scaleKey, shortGpu } from "./view";

const lines: Line[] = [
  { box: [564, 155, 657, 467], vertical: true, japanese: "ちょっと待って", korean: "잠깐만", letter: 40 },
  { box: [56, 675, 448, 719], vertical: false, japanese: "その夜", korean: "그날 밤", letter: 38 },
];

describe("보기 계산", () => {
  it("글자 크기 단계", () => {
    expect(scaleKey(0.92)).toBe("0.92");
    expect(scaleKey(0.7)).toBe("0.7");
    expect(scaleKey(0.8)).toBe("0.82");
    expect(scaleKey(1.2)).toBe("1.05");
  });

  it("그림을 칸에 맞추되 늘리지 않음", () => {
    expect(fit(800, 1100, 400, 400)).toEqual({ width: 291, height: 400 });
    expect(fit(800, 1100, 2000, 2000)).toEqual({ width: 800, height: 1100 });
    expect(fit(0, 10, 100, 100)).toEqual({ width: 0, height: 0 });
  });

  it("대사 상자 위치(백분율)", () => {
    expect(boxStyle([80, 110, 160, 330], 800, 1100)).toEqual({ left: "10.000%", top: "10.000%", width: "10.000%", height: "20.000%" });
  });

  it("고친 대사와 보낼 번역문", () => {
    expect(changed(lines, ["잠깐만", "그날 밤"])).toBe(false);
    expect(changed(lines, [])).toBe(false);
    expect(changed(lines, ["잠깐!", "그날 밤"])).toBe(true);
    expect(koreanFor(lines, ["잠깐! "])).toEqual(["잠깐!", "그날 밤"]);
  });

  it("GPU 이름과 파일 이름", () => {
    expect(shortGpu("NVIDIA GeForce RTX 5070 Ti", "cuda")).toBe("RTX 5070 Ti");
    expect(shortGpu(null, "cpu")).toBe("CPU로 처리");
    expect(fileName("C:\\a\\b\\p1.jpg")).toBe("p1.jpg");
  });

  it("Windows 경로 비교는 대소문자를 가리지 않음", () => {
    expect(samePath("C:\\WINDOWS\\Fonts\\malgunbd.ttf", "C:\\Windows\\Fonts\\malgunbd.ttf")).toBe(true);
    expect(samePath("C:/Windows/Fonts/malgunbd.ttf", "c:\\windows\\fonts\\MALGUNBD.TTF")).toBe(true);
    expect(samePath("C:\\Windows\\Fonts\\malgun.ttf", "C:\\Windows\\Fonts\\malgunbd.ttf")).toBe(false);
  });
});
