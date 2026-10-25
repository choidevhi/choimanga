import { imageUrl } from "./api";
import { Icon } from "./icons";
import { isWorking, phaseLabel, progress, type Job } from "./queue";

const tone: Record<Job["phase"], string> = {
  waiting: "phase",
  detect: "phase blue",
  ocr: "phase blue",
  translate: "phase blue",
  erase: "phase blue",
  typeset: "phase blue",
  done: "phase green",
  failed: "phase red",
};

function Row({ job, selected, onSelect, onRetry }: { job: Job; selected: boolean; onSelect: () => void; onRetry: () => void }) {
  return (
    <div className={selected ? "q-row on" : "q-row"} data-job={job.id} data-phase={job.phase} data-name={job.name} onClick={onSelect}>
      <div className="q-thumb">
        <img src={imageUrl(job.source)} alt="" loading="lazy" decoding="async" draggable={false} />
      </div>
      <div className="q-text">
        <div className="q-name clip" title={job.source}>
          {job.name}
        </div>
        <div className={tone[job.phase]} data-phase-label>
          {isWorking(job.phase) ? <span className="spin small" /> : null}
          {phaseLabel[job.phase]}
        </div>
        {job.error !== null ? (
          <div className="q-error clip2" title={job.error} data-job-error>
            {job.error}
          </div>
        ) : null}
      </div>
      {job.phase === "failed" ? (
        <button
          type="button"
          className="icon-btn"
          aria-label="다시 시도"
          title="다시 시도"
          data-retry
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
        >
          <Icon.Retry />
        </button>
      ) : null}
    </div>
  );
}

export function QueuePanel({
  jobs,
  running,
  current,
  selected,
  onSelect,
  onStart,
  onStop,
  onClear,
  onRetry,
}: {
  jobs: readonly Job[];
  running: boolean;
  current: number | null;
  selected: number | null;
  onSelect: (id: number) => void;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  onRetry: (id: number) => void;
}) {
  const { done, total } = progress(jobs);
  const waiting = jobs.some((job) => job.phase === "waiting");
  const percent = total === 0 ? 0 : (done / total) * 100;

  return (
    <aside className="queue">
      <div className="q-head">
        <div className="q-title">
          <b>목록</b>
          <span className="q-count" data-progress={`${done}/${total}`}>
            완료 {done}/{total}
          </span>
        </div>
        <div className="bar">
          <i style={{ width: `${percent}%` }} />
        </div>
        <div className="q-actions">
          {running ? (
            <button type="button" className="outlined small" data-stop onClick={onStop}>
              <Icon.Pause />
              멈추기
            </button>
          ) : (
            <button type="button" className="filled small" data-start disabled={!waiting} onClick={onStart}>
              <Icon.Play />
              {current !== null ? "이어서 하기" : "시작"}
            </button>
          )}
          <button type="button" className="text-btn small" data-clear disabled={done === 0} onClick={onClear}>
            <Icon.Trash />
            끝난 것 지우기
          </button>
        </div>
      </div>
      <div className="q-list">
        {jobs.length === 0 ? (
          <div className="q-empty">
            그림이나 폴더를
            <br />
            창에 끌어다 놓으세요
          </div>
        ) : null}
        {jobs.map((job) => (
          <Row key={job.id} job={job} selected={job.id === selected} onSelect={() => onSelect(job.id)} onRetry={() => onRetry(job.id)} />
        ))}
      </div>
    </aside>
  );
}
