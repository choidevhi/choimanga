import type { Item, Page } from "./api";

// 번역 목록. 화면(React)이 들고 있고, 엔진에는 한 번에 한 장씩 보낸다. 모두 순수 함수.

export const steps = ["detect", "ocr", "translate", "erase", "typeset"] as const;

export type Step = (typeof steps)[number];

export type Phase = "waiting" | Step | "done" | "failed";

export type Job = {
  id: number;
  source: string;
  output: string;
  name: string;
  phase: Phase;
  error: string | null;
  page: Page | null;
  /** 번역본 그림을 새로 읽게 하는 번호(?v=). */
  version: number;
};

export const phaseLabel: Record<Phase, string> = {
  waiting: "대기",
  detect: "글자 찾는 중",
  ocr: "읽는 중",
  translate: "번역 중",
  erase: "지우는 중",
  typeset: "쓰는 중",
  done: "완료",
  failed: "실패",
};

const stepNames: ReadonlyMap<string, Step> = new Map(steps.map((step) => [step, step]));

/** 엔진이 보낸 단계 이름을 읽는다. 모르는 이름이면 null. */
export function parseStep(text: string): Step | null {
  return stepNames.get(text) ?? null;
}

export function isWorking(phase: Phase): boolean {
  return phase !== "waiting" && phase !== "done" && phase !== "failed";
}

/** 새 장을 뒤에 붙인다. 이미 목록에 있는 원본은 다시 넣지 않는다. */
export function addJobs(jobs: readonly Job[], items: readonly Item[]): { jobs: Job[]; added: Job[] } {
  const known = new Set(jobs.map((job) => job.source.toLowerCase()));
  let nextId = jobs.reduce((max, job) => Math.max(max, job.id), 0) + 1;
  const added: Job[] = [];

  for (const item of items) {
    const key = item.source.toLowerCase();

    if (known.has(key)) {
      continue;
    }

    known.add(key);
    added.push({ id: nextId, source: item.source, output: item.output, name: item.name, phase: "waiting", error: null, page: null, version: 0 });
    nextId += 1;
  }

  return { jobs: [...jobs, ...added], added };
}

export function nextWaiting(jobs: readonly Job[]): Job | undefined {
  return jobs.find((job) => job.phase === "waiting");
}

function edit(jobs: readonly Job[], id: number, change: (job: Job) => Job): Job[] {
  return jobs.map((job) => (job.id === id ? change(job) : job));
}

/** 진행 단계. 끝난(완료·실패) 장에 늦게 온 단계는 무시한다. */
export function withStep(jobs: readonly Job[], id: number, step: Step): Job[] {
  return edit(jobs, id, (job) => (job.phase === "done" || job.phase === "failed" ? job : { ...job, phase: step }));
}

export function begin(jobs: readonly Job[], id: number): Job[] {
  return edit(jobs, id, (job) => ({ ...job, phase: "detect", error: null }));
}

export function finish(jobs: readonly Job[], id: number, page: Page): Job[] {
  return edit(jobs, id, (job) => ({ ...job, phase: "done", error: null, page, output: page.output, version: job.version + 1 }));
}

/** 다시 쓰기 뒤: 새 대사와 그림 번호. */
export function rewritten(jobs: readonly Job[], id: number, page: Page): Job[] {
  return edit(jobs, id, (job) => ({ ...job, page, version: job.version + 1 }));
}

export function fail(jobs: readonly Job[], id: number, error: string): Job[] {
  return edit(jobs, id, (job) => ({ ...job, phase: "failed", error }));
}

export function retry(jobs: readonly Job[], id: number): Job[] {
  return edit(jobs, id, (job) => (job.phase === "failed" ? { ...job, phase: "waiting", error: null } : job));
}

export function clearDone(jobs: readonly Job[]): Job[] {
  return jobs.filter((job) => job.phase !== "done");
}

export function progress(jobs: readonly Job[]): { done: number; total: number } {
  let done = 0;

  for (const job of jobs) {
    if (job.phase === "done") {
      done += 1;
    }
  }

  return { done, total: jobs.length };
}

/** 지운 뒤 고를 장: 고른 것이 남아 있으면 그대로, 아니면 첫 장. */
export function keepSelection(jobs: readonly Job[], selected: number | null): number | null {
  if (selected !== null && jobs.some((job) => job.id === selected)) {
    return selected;
  }

  return jobs[0]?.id ?? null;
}
