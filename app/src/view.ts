import type { Box, Line } from "./api";

// 보기 화면의 계산. 모두 순수 함수.

export const scales = [
  { value: "0.7", label: "아주 작게" },
  { value: "0.82", label: "작게" },
  { value: "0.92", label: "보통" },
  { value: "1.05", label: "크게" },
] as const;

export type ScaleKey = (typeof scales)[number]["value"];

/** 설정의 글자 크기 숫자를 단계 이름으로(가장 가까운 단계). */
export function scaleKey(scale: number): ScaleKey {
  let best: ScaleKey = "0.92";

  for (const step of scales) {
    if (Math.abs(Number(step.value) - scale) < Math.abs(Number(best) - scale)) {
      best = step.value;
    }
  }

  return best;
}

/** 그림을 칸 안에 비율 그대로 맞춘 크기. 원래보다 크게 늘리지는 않는다. */
export function fit(width: number, height: number, areaWidth: number, areaHeight: number): { width: number; height: number } {
  if (width <= 0 || height <= 0 || areaWidth <= 0 || areaHeight <= 0) {
    return { width: 0, height: 0 };
  }

  const ratio = Math.min(areaWidth / width, areaHeight / height, 1);

  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

/** 대사 상자를 그림 위 백분율 위치로. */
export function boxStyle(box: Box, width: number, height: number): { left: string; top: string; width: string; height: string } {
  const [left, top, right, bottom] = box;
  const percent = (value: number, whole: number) => `${((value / whole) * 100).toFixed(3)}%`;

  return { left: percent(left, width), top: percent(top, height), width: percent(right - left, width), height: percent(bottom - top, height) };
}

/** 고친 대사가 있는지. */
export function changed(lines: readonly Line[], drafts: readonly string[]): boolean {
  return lines.some((line, index) => (drafts[index] ?? line.korean) !== line.korean);
}

/** 다시 쓰기에 보낼 번역문(대사 순서 그대로). 줄 끝 공백은 뗀다. */
export function koreanFor(lines: readonly Line[], drafts: readonly string[]): string[] {
  return lines.map((line, index) => (drafts[index] ?? line.korean).trim());
}

/** 엔진 상태 줄에 쓸 GPU 이름: "NVIDIA GeForce RTX 5070 Ti" → "RTX 5070 Ti". */
export function shortGpu(gpu: string | null, device: string): string {
  if (gpu === null) {
    return device === "cuda" ? "GPU" : "CPU로 처리";
  }

  return gpu.replace(/^NVIDIA\s+/i, "").replace(/^GeForce\s+/i, "");
}

/** Windows 경로는 대소문자와 빗금 방향을 가리지 않는다(엔진은 C:\WINDOWS\Fonts처럼 줄 수 있다). */
export function samePath(a: string, b: string): boolean {
  const norm = (path: string) => path.replaceAll("/", "\\").toLowerCase();

  return norm(a) === norm(b);
}

export function fileName(path: string): string {
  const parts = path.split(/[\\/]/);

  return parts[parts.length - 1] ?? path;
}
