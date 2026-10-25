import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, message, on, type Boot, type EngineState, type Font, type Page, type Settings, type Status } from "./api";
import { Icon } from "./icons";
import { addJobs, begin, clearDone, fail, finish, keepSelection, nextWaiting, parseStep, retry, rewritten, withStep, type Job } from "./queue";
import { QueuePanel } from "./QueuePanel";
import { SettingsScreen } from "./SettingsScreen";
import { useToast } from "./ui";
import { shortGpu } from "./view";
import { Viewer } from "./Viewer";
import icon from "../src-tauri/icons/128x128.png";

type Screen = "main" | "settings";

function EngineChips({ engine, status, onOllama, starting }: { engine: EngineState; status: Status | null; onOllama: () => void; starting: boolean }) {
  if (engine.state === "failed") {
    return (
      <span className="badge red clip" data-engine="failed" title={engine.message}>
        엔진 문제: {engine.message}
      </span>
    );
  }

  if (engine.state !== "ready" || status === null) {
    return (
      <span className="badge" data-engine="starting">
        <span className="spin small" />
        엔진 준비 중
      </span>
    );
  }

  return (
    <>
      <span className="badge" data-engine="ready" data-gpu={status.gpu ?? ""}>
        <Icon.Chip />
        {shortGpu(status.gpu, status.device)}
      </span>
      {status.ollama === null ? (
        <span className="badge green" data-ollama="on">
          Ollama 연결됨
        </span>
      ) : (
        <>
          <span className="badge red" data-ollama="off" title={status.ollama}>
            Ollama 꺼짐
          </span>
          <button type="button" className="tonal small" data-start-ollama disabled={starting} onClick={onOllama}>
            {starting ? <span className="spin small" /> : <Icon.Power />}
            Ollama 켜기
          </button>
        </>
      )}
    </>
  );
}

function App({ boot }: { boot: Boot }) {
  const [settings, setSettings] = useState(boot.settings);
  const [engine, setEngine] = useState<EngineState>(boot.engine);
  const [status, setStatus] = useState<Status | null>(null);
  const [fonts, setFonts] = useState<Font[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [screen, setScreen] = useState<Screen>("main");
  const [dragging, setDragging] = useState(false);
  const [ollamaStarting, setOllamaStarting] = useState(false);
  const [toastNode, toast] = useToast();
  const jobsRef = useRef(jobs);
  const settingsRef = useRef(settings);

  jobsRef.current = jobs;
  settingsRef.current = settings;

  const refreshStatus = useCallback(async (): Promise<Status | null> => {
    try {
      const next = await api.status();

      setStatus(next);

      return next;
    } catch (cause) {
      toast(message(cause), false);

      return null;
    }
  }, [toast]);

  useEffect(() => {
    const stops = [
      on("engine", setEngine),
      on("step", (event) => {
        const step = parseStep(event.step);

        if (step !== null) {
          setJobs((list) => withStep(list, event.job, step));
        }
      }),
    ];

    return () => {
      for (const stop of stops) {
        void stop.then((unlisten) => unlisten());
      }
    };
  }, []);

  useEffect(() => {
    if (engine.state === "ready") {
      void refreshStatus();
    }
  }, [engine.state, refreshStatus]);

  const addPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) {
        return;
      }

      try {
        const items = await api.expand(paths);
        const result = addJobs(jobsRef.current, items);

        if (result.added.length === 0) {
          toast(items.length === 0 ? "넣을 그림이 없어요. jpg, png, webp 그림이나 그 폴더를 넣어 주세요." : "이미 목록에 있는 그림이에요.", false);

          return;
        }

        setJobs((list) => addJobs(list, items).jobs);
        setSelected((now) => now ?? result.added[0]?.id ?? null);
        toast(`${result.added.length}장을 넣었어요`);

        if (settingsRef.current.autoStart) {
          setRunning(true);
        }
      } catch (cause) {
        toast(message(cause), false);
      }
    },
    [toast],
  );

  useEffect(() => {
    const stop = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setDragging(true);
      } else if (event.payload.type === "drop") {
        setDragging(false);
        void addPaths(event.payload.paths);
      } else {
        setDragging(false);
      }
    });

    return () => {
      void stop.then((unlisten) => unlisten());
    };
  }, [addPaths]);

  // 한 장씩: 돌리는 중이고 처리 중인 장이 없으면 다음 대기 장을 엔진에 보낸다.
  useEffect(() => {
    if (!running || current !== null) {
      return;
    }

    const next = nextWaiting(jobs);

    if (next === undefined) {
      setRunning(false);

      return;
    }

    setCurrent(next.id);
    setJobs((list) => begin(list, next.id));
    api
      .process(next.id, next.source, next.output)
      .then(
        (page) => setJobs((list) => finish(list, next.id, page)),
        (cause: unknown) => setJobs((list) => fail(list, next.id, message(cause))),
      )
      .finally(() => setCurrent(null));
  }, [running, current, jobs]);

  async function saveSettings(next: Settings): Promise<Settings> {
    const saved = await api.saveSettings(next);

    setSettings(saved);

    return saved;
  }

  async function pickFiles() {
    try {
      await addPaths(await api.pickFiles());
    } catch (cause) {
      toast(message(cause), false);
    }
  }

  async function pickFolder() {
    try {
      const folder = await api.pickFolder("번역할 폴더 고르기", null);

      if (folder !== null) {
        await addPaths([folder]);
      }
    } catch (cause) {
      toast(message(cause), false);
    }
  }

  async function startOllama() {
    setOllamaStarting(true);

    try {
      await api.startOllama();

      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));

        const next = await refreshStatus();

        if (next?.ollama === null) {
          toast("Ollama를 켰어요");
          break;
        }
      }
    } catch (cause) {
      toast(message(cause), false);
    } finally {
      setOllamaStarting(false);
    }
  }

  function clearFinished() {
    const left = clearDone(jobsRef.current);

    setJobs((list) => clearDone(list));
    setSelected((now) => keepSelection(left, now));
  }

  const onPage = useCallback((id: number, page: Page) => setJobs((list) => rewritten(list, id, page)), []);
  const job = jobs.find((item) => item.id === selected) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src={icon} alt="" />
          <b>ChoiManga</b>
        </div>
        <button type="button" className="filled small" data-add-files onClick={() => void pickFiles()}>
          <Icon.FileAdd />
          파일 넣기
        </button>
        <button type="button" className="outlined small" data-add-folder onClick={() => void pickFolder()}>
          <Icon.FolderAdd />
          폴더 넣기
        </button>
        <div className="topbar-grow" />
        <EngineChips engine={engine} status={status} onOllama={() => void startOllama()} starting={ollamaStarting} />
        <button
          type="button"
          className={screen === "settings" ? "icon-btn on" : "icon-btn"}
          data-open-settings
          aria-label="설정"
          title="설정"
          onClick={() => setScreen(screen === "settings" ? "main" : "settings")}
        >
          <Icon.Settings />
        </button>
      </header>

      <div className="body" hidden={screen !== "main"} data-screen="main">
        <QueuePanel
          jobs={jobs}
          running={running}
          current={current}
          selected={selected}
          onSelect={setSelected}
          onStart={() => setRunning(true)}
          onStop={() => {
            setRunning(false);

            if (current !== null) {
              toast("지금 장까지 하고 멈춰요");
            }
          }}
          onClear={clearFinished}
          onRetry={(id) => {
            setJobs((list) => retry(list, id));
            setRunning(true);
          }}
        />
        <Viewer
          key={job?.id ?? 0}
          job={job}
          settings={settings}
          onSettings={saveSettings}
          onPage={onPage}
          toast={toast}
          onPickFiles={() => void pickFiles()}
          onPickFolder={() => void pickFolder()}
        />
      </div>

      <div className="scroll" hidden={screen !== "settings"} data-screen="settings">
        {screen === "settings" ? (
          <SettingsScreen
            settings={settings}
            defaults={boot.defaults}
            status={status}
            fonts={fonts}
            onFonts={setFonts}
            onSave={saveSettings}
            onBack={() => setScreen("main")}
            version={boot.version}
            log={boot.log}
            toast={toast}
          />
        ) : null}
      </div>

      {dragging ? (
        <div className="drop-veil" data-drop-veil>
          <div className="drop-card">
            <Icon.Drop />
            <b>놓으면 목록에 넣어요</b>
            <span>폴더는 하위 폴더까지 jpg, png, webp를 순서대로 넣어요.</span>
          </div>
        </div>
      ) : null}
      {toastNode}
    </div>
  );
}

export function Root() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.boot().then(setBoot, () => setFailed(true));
  }, []);

  if (failed) {
    return <div className="empty">앱을 시작하지 못했어요. 다시 켜 주세요.</div>;
  }

  return boot === null ? <div className="app" /> : <App boot={boot} />;
}
