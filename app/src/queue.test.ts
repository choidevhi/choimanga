import { describe, expect, it } from "vitest";

import type { Item, Page } from "./api";
import { addJobs, begin, clearDone, fail, finish, keepSelection, nextWaiting, parseStep, phaseLabel, progress, retry, rewritten, withStep } from "./queue";

const items: Item[] = [
  { source: "D:\\책\\1.jpg", output: "D:\\책_ko\\1.jpg", name: "1.jpg" },
  { source: "D:\\책\\2.jpg", output: "D:\\책_ko\\2.jpg", name: "2.jpg" },
];

const page: Page = { source: "D:\\책\\1.jpg", output: "D:\\책_ko\\1.jpg", width: 800, height: 1100, lines: [] };

describe("목록", () => {
  it("넣으면 대기로 붙고 같은 원본은 한 번만", () => {
    const first = addJobs([], items);
    const again = addJobs(first.jobs, [{ ...items[1]!, source: "d:\\책\\2.JPG" }, { source: "D:\\책\\3.jpg", output: "x", name: "3.jpg" }]);

    expect(first.jobs.map((job) => [job.id, job.phase])).toEqual([
      [1, "waiting"],
      [2, "waiting"],
    ]);
    expect(again.added.map((job) => job.name)).toEqual(["3.jpg"]);
    expect(again.jobs.at(-1)?.id).toBe(3);
  });

  it("단계, 완료, 실패, 다시 시도", () => {
    let jobs = addJobs([], items).jobs;

    expect(nextWaiting(jobs)?.id).toBe(1);
    jobs = begin(jobs, 1);
    expect(jobs[0]?.phase).toBe("detect");
    jobs = withStep(jobs, 1, "translate");
    expect(phaseLabel[jobs[0]!.phase]).toBe("번역 중");
    jobs = finish(jobs, 1, page);
    expect(jobs[0]).toMatchObject({ phase: "done", version: 1, page });
    // 끝난 뒤 늦게 온 단계는 무시한다.
    expect(withStep(jobs, 1, "typeset")[0]?.phase).toBe("done");
    expect(nextWaiting(jobs)?.id).toBe(2);
    jobs = fail(begin(jobs, 2), 2, "엔진이 멈췄어요.");
    expect(jobs[1]).toMatchObject({ phase: "failed", error: "엔진이 멈췄어요." });
    expect(nextWaiting(jobs)).toBeUndefined();
    jobs = retry(jobs, 2);
    expect(jobs[1]).toMatchObject({ phase: "waiting", error: null });
    expect(rewritten(jobs, 1, page)[0]?.version).toBe(2);
  });

  it("전체 진행과 끝난 것 지우기", () => {
    const jobs = finish(addJobs([], items).jobs, 2, { ...page, source: "D:\\책\\2.jpg" });

    expect(progress(jobs)).toEqual({ done: 1, total: 2 });
    expect(clearDone(jobs).map((job) => job.id)).toEqual([1]);
    expect(keepSelection(clearDone(jobs), 2)).toBe(1);
    expect(keepSelection(jobs, 2)).toBe(2);
    expect(keepSelection([], 2)).toBeNull();
  });

  it("엔진 단계 이름 읽기", () => {
    expect(parseStep("ocr")).toBe("ocr");
    expect(parseStep("typeset")).toBe("typeset");
    expect(parseStep("dance")).toBeNull();
  });
});
