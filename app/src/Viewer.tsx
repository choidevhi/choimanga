import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { api, imageUrl, message, type Page, type Settings } from "./api";
import { Icon } from "./icons";
import { phaseLabel, isWorking, type Job } from "./queue";
import { GrowText, Segmented } from "./ui";
import { boxStyle, changed, fit, koreanFor, scaleKey, scales, type ScaleKey } from "./view";

type Show = "translated" | "original";

const shows = [
  { value: "translated", label: "번역본" },
  { value: "original", label: "원본" },
] as const;

/** 칸 크기를 따라가는 그림 크기. */
function useAreaSize(): [RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const area = ref.current;

    if (area === null) {
      return;
    }

    const observer = new ResizeObserver(() => setSize({ width: area.clientWidth, height: area.clientHeight }));

    observer.observe(area);

    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

function Empty({ onPickFiles, onPickFolder }: { onPickFiles: () => void; onPickFolder: () => void }) {
  return (
    <section className="viewer">
      <div className="empty" data-viewer-empty>
        <div className="empty-icon">
          <Icon.Image />
        </div>
        <div className="empty-title">번역할 만화 그림을 넣어 주세요</div>
        <div className="empty-text">{"그림 파일이나 폴더를 창 어디에나 끌어다 놓아도 돼요.\n번역은 이 PC 안에서만 해요."}</div>
        <div className="empty-actions">
          <button type="button" className="filled" onClick={onPickFiles}>
            <Icon.FileAdd />
            파일 넣기
          </button>
          <button type="button" className="outlined" onClick={onPickFolder}>
            <Icon.FolderAdd />
            폴더 넣기
          </button>
        </div>
      </div>
    </section>
  );
}

export function Viewer({
  job,
  settings,
  onSettings,
  onPage,
  toast,
  onPickFiles,
  onPickFolder,
}: {
  job: Job | null;
  settings: Settings;
  onSettings: (next: Settings) => Promise<Settings>;
  onPage: (id: number, page: Page) => void;
  toast: (text: string, ok?: boolean) => void;
  onPickFiles: () => void;
  onPickFolder: () => void;
}) {
  const page = job?.page ?? null;
  const [show, setShow] = useState<Show>("translated");
  const [drafts, setDrafts] = useState<string[]>(() => (page === null ? [] : page.lines.map((line) => line.korean)));
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [areaRef, area] = useAreaSize();

  useEffect(() => {
    setDrafts(page === null ? [] : page.lines.map((line) => line.korean));
  }, [page]);

  if (job === null) {
    return <Empty onPickFiles={onPickFiles} onPickFolder={onPickFolder} />;
  }

  const done = job.phase === "done" && page !== null;
  const showing: Show = done ? show : "original";
  const src = showing === "translated" ? imageUrl(job.output, job.version) : imageUrl(job.source);
  const size = page === null ? null : fit(page.width, page.height, area.width - 32, area.height - 32);
  const dirty = page !== null && changed(page.lines, drafts);

  async function rewrite(korean: string[] | null, note: string) {
    if (job === null) {
      return;
    }

    setBusy(true);

    try {
      onPage(job.id, await api.retypeset(job.output, korean));
      setShow("translated");
      toast(note);
    } catch (cause) {
      toast(message(cause), false);
    } finally {
      setBusy(false);
    }
  }

  async function changeScale(key: ScaleKey) {
    try {
      await onSettings({ ...settings, scale: Number(key) });
    } catch (cause) {
      toast(message(cause), false);

      return;
    }

    if (done && page !== null) {
      await rewrite(dirty ? koreanFor(page.lines, drafts) : null, "글자 크기를 바꿔 다시 썼어요");
    }
  }

  async function reveal() {
    try {
      await api.reveal(job?.output ?? "");
    } catch (cause) {
      toast(message(cause), false);
    }
  }

  return (
    <section className="viewer" data-viewer={job.id}>
      <div className="v-bar">
        <div className="v-name clip" title={job.source}>
          {job.name}
        </div>
        <Segmented<Show> name="show" small options={shows} value={showing} disabled={!done} onChange={setShow} />
        <div className="v-bar-grow" />
        <span className="v-label">글자 크기</span>
        <Segmented<ScaleKey> name="scale" small options={scales} value={scaleKey(settings.scale)} disabled={busy} onChange={(key) => void changeScale(key)} />
        <button type="button" className="outlined small" data-reveal disabled={!done} onClick={() => void reveal()}>
          <Icon.Folder />
          폴더 열기
        </button>
      </div>

      <div className="v-body">
        <div className="stage" ref={areaRef}>
          {size === null ? (
            <img className="stage-free" src={src} alt="" draggable={false} data-image={showing} />
          ) : (
            <div className="stage-frame" style={{ width: size.width, height: size.height }}>
              <img src={src} alt="" draggable={false} data-image={showing} />
              {page?.lines.map((line, index) => (
                <div
                  key={index}
                  className={chosen === index ? "box on" : "box"}
                  style={boxStyle(line.box, page.width, page.height)}
                  data-box={index}
                  onClick={() => setChosen(index)}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="lines">
          <div className="lines-head">
            <b>대사</b>
            {page !== null ? <span className="muted">{page.lines.length}개</span> : null}
          </div>
          <div className="lines-list">
            {job.phase === "failed" ? (
              <div className="lines-note red" data-note>
                {job.error}
              </div>
            ) : null}
            {page === null && job.phase !== "failed" ? (
              <div className="lines-note" data-note>
                {isWorking(job.phase) ? <span className="spin small" /> : null}
                {job.phase === "waiting" ? "차례가 오면 번역해요." : `${phaseLabel[job.phase]}이에요.`}
              </div>
            ) : null}
            {page !== null && page.lines.length === 0 ? <div className="lines-note">이 장에서 번역할 일본어를 찾지 못했어요.</div> : null}
            {page?.lines.map((line, index) => (
              <div key={index} className={chosen === index ? "line on" : "line"} data-line={index} onClick={() => setChosen(index)}>
                <div className="line-ja" lang="ja">
                  {line.japanese}
                </div>
                <GrowText
                  value={drafts[index] ?? line.korean}
                  label={`${index + 1}번 대사 한국어`}
                  index={index}
                  onFocus={() => setChosen(index)}
                  onChange={(next) =>
                    setDrafts((list) => {
                      const copy = page.lines.map((item, at) => list[at] ?? item.korean);

                      copy[index] = next;

                      return copy;
                    })
                  }
                />
              </div>
            ))}
          </div>
          {page !== null && page.lines.length > 0 ? (
            <div className="lines-foot">
              {dirty ? (
                <button type="button" className="text-btn small" disabled={busy} onClick={() => setDrafts(page.lines.map((line) => line.korean))}>
                  되돌리기
                </button>
              ) : null}
              <button
                type="button"
                className="filled"
                data-rewrite
                disabled={busy || !done}
                onClick={() => void rewrite(koreanFor(page.lines, drafts), "다시 썼어요")}
              >
                {busy ? <span className="spin small" /> : <Icon.Pen />}
                다시 쓰기
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
