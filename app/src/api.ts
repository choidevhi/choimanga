import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// Rust 쪽(serde) 타입과 같은 모양. Option은 null로 온다.

export type SaveMode = "beside" | "fixed";

export type Settings = {
  model: string;
  font: string;
  scale: number;
  saveMode: SaveMode;
  fixedFolder: string;
  autoStart: boolean;
  engineDir: string;
};

export type EngineState = { state: "starting" } | { state: "ready" } | { state: "failed"; message: string } | { state: "stopped" };

export type Status = { device: string; gpu: string | null; models: string[]; ollama: string | null };

export type Font = { path: string; name: string };

export type Box = [number, number, number, number];

export type Line = { box: Box; vertical: boolean; japanese: string; korean: string; letter: number };

export type Page = { source: string; output: string; width: number; height: number; lines: Line[] };

export type Item = { source: string; output: string; name: string };

export type Boot = { version: string; settings: Settings; defaults: Settings; engine: EngineState; log: string };

export type StepEvent = { job: number; step: string };

export const api = {
  boot: () => invoke<Boot>("boot"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  status: () => invoke<Status>("engine_status"),
  fonts: () => invoke<Font[]>("engine_fonts"),
  process: (job: number, source: string, output: string) => invoke<Page>("process_page", { job, source, output }),
  retypeset: (output: string, korean: string[] | null) => invoke<Page>("retypeset_page", { output, korean }),
  expand: (paths: string[]) => invoke<Item[]>("expand_paths", { paths }),
  pickFiles: () => invoke<string[]>("pick_files"),
  pickFolder: (title: string, start: string | null) => invoke<string | null>("pick_folder", { title, start }),
  reveal: (path: string) => invoke<void>("reveal", { path }),
  startOllama: () => invoke<void>("start_ollama"),
};

type Events = { engine: EngineState; step: StepEvent };

export function on<K extends keyof Events>(name: K, handler: (payload: Events[K]) => void): Promise<UnlistenFn> {
  return listen<Events[K]>(name, (event) => handler(event.payload));
}

/** 로컬 그림 주소(asset 프로토콜). version이 바뀌면 새로 읽는다. */
export function imageUrl(path: string, version = 0): string {
  return `${convertFileSrc(path)}?v=${version}`;
}

/** invoke가 던진 것은 Rust가 보낸 한국어 문자열이다. */
export function message(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  const text = String(cause);

  return text === "" ? "알 수 없는 문제가 생겼어요." : text;
}
