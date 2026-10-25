//! 엔진 프로세스 하나를 띄우고 돌본다. 요청은 한 번에 하나(GPU 하나), id를 붙여 보내고 같은 id의 답을 기다린다.
//! 진행(step)은 부른 쪽에 넘기고, stderr는 로그 파일로 보낸다. 엔진이 죽으면 그 요청은 실패로 돌려주고 다시 띄운다.
//! 끝낼 때는 shutdown을 보내고, 그래도 남아 있으면 이 앱이 띄운 PID(와 그 자식)만 닫는다.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::protocol::{self, Message};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const LOG_LIMIT: u64 = 8 * 1024 * 1024;

/// 엔진을 띄우는 방법. 실제로는 `<엔진 폴더>\.venv\Scripts\python.exe -m choimanga.server`.
#[derive(Debug, Clone)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

pub type Launcher = Box<dyn Fn(&Path) -> Result<Launch, String> + Send + Sync>;

pub fn python_launcher() -> Launcher {
    Box::new(|dir: &Path| {
        let program = dir.join(".venv").join("Scripts").join("python.exe");

        if !program.is_file() {
            return Err(format!("엔진을 찾지 못했어요({}). 설정에서 엔진 폴더를 확인해 주세요.", program.display()));
        }

        Ok(Launch { program, args: vec!["-m".into(), "choimanga.server".into()], cwd: dir.to_path_buf() })
    })
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "state", content = "message")]
pub enum State {
    Starting,
    Ready,
    Failed(String),
    Stopped,
}

struct Proc {
    child: Child,
    stdin: ChildStdin,
    rx: Receiver<Message>,
    dir: PathBuf,
}

pub struct Engine {
    dir: Mutex<PathBuf>,
    log: PathBuf,
    launcher: Launcher,
    slot: Mutex<Option<Proc>>,
    pid: AtomicU32,
    next_id: AtomicU64,
    closing: AtomicBool,
    ready_timeout: Duration,
    notify: Box<dyn Fn(State) + Send + Sync>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn quiet(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command
}

/// 이 앱이 띄운 PID와 그 자식만 닫는다(venv의 python.exe는 진짜 python을 자식으로 띄운다).
fn kill_tree(pid: u32) {
    if pid == 0 {
        return;
    }

    let _ = quiet("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
}

fn open_log(path: &Path) -> Option<File> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // 너무 커지면 한 번 비운다(지난 것은 .old.log로).
    if fs::metadata(path).map(|meta| meta.len() > LOG_LIMIT).unwrap_or(false) {
        let _ = fs::rename(path, path.with_extension("old.log"));
    }

    OpenOptions::new().create(true).append(true).open(path).ok()
}

/// 로그 끝 몇 줄(엔진이 시작하다 죽었을 때 이유를 보이려고).
fn log_tail(path: &Path, count: usize) -> String {
    let text = fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().filter(|line| !line.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(count);

    lines[start..].join(" / ")
}

impl Engine {
    pub fn new(dir: PathBuf, log: PathBuf, launcher: Launcher, notify: Box<dyn Fn(State) + Send + Sync>) -> Arc<Self> {
        Arc::new(Self {
            dir: Mutex::new(dir),
            log,
            launcher,
            slot: Mutex::new(None),
            pid: AtomicU32::new(0),
            next_id: AtomicU64::new(1),
            closing: AtomicBool::new(false),
            ready_timeout: Duration::from_secs(300),
            notify,
        })
    }

    /// 지금 떠 있는 엔진의 PID(없으면 0).
    pub fn pid(&self) -> u32 {
        self.pid.load(Ordering::SeqCst)
    }

    /// 엔진 폴더를 바꾼다. 다음 요청 때 새 폴더로 다시 띄운다.
    pub fn set_dir(self: &Arc<Self>, dir: PathBuf) {
        let changed = {
            let mut current = lock(&self.dir);
            let changed = *current != dir;

            *current = dir;

            changed
        };

        if changed {
            self.warm();
        }
    }

    /// 뒤에서 엔진을 미리 띄운다.
    pub fn warm(self: &Arc<Self>) {
        let engine = self.clone();

        std::thread::spawn(move || {
            let mut slot = lock(&engine.slot);
            let _ = engine.ensure(&mut slot);
        });
    }

    fn spawn(&self, dir: &Path) -> Result<Proc, String> {
        let launch = (self.launcher)(dir)?;
        let mut command = quiet(&launch.program);

        command
            .args(&launch.args)
            .current_dir(&launch.cwd)
            .env("PYTHONUTF8", "1")
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command.spawn().map_err(|error| format!("엔진을 띄우지 못했어요: {error}"))?;
        let stdin = child.stdin.take().ok_or("엔진 입력을 열지 못했어요.")?;
        let stdout = child.stdout.take().ok_or("엔진 출력을 열지 못했어요.")?;
        let stderr = child.stderr.take();
        let (tx, rx) = mpsc::channel();
        let log = self.log.clone();

        self.pid.store(child.id(), Ordering::SeqCst);

        std::thread::spawn(move || {
            for line in BufReader::new(stdout).split(b'\n').map_while(Result::ok) {
                if let Some(message) = protocol::parse(&String::from_utf8_lossy(&line)) {
                    if tx.send(message).is_err() {
                        break;
                    }
                }
            }
        });

        if let Some(pipe) = stderr {
            std::thread::spawn(move || {
                let mut file = open_log(&log);

                for line in BufReader::new(pipe).split(b'\n').map_while(Result::ok) {
                    if let Some(file) = file.as_mut() {
                        let _ = file.write_all(&line);
                        let _ = file.write_all(b"\n");
                    }
                }
            });
        }

        Ok(Proc { child, stdin, rx, dir: dir.to_path_buf() })
    }

    fn stop_proc(&self, proc: Proc) {
        let Proc { mut child, mut stdin, .. } = proc;
        let line = protocol::request(0, "shutdown", Value::Null);
        let _ = stdin.write_all(line.as_bytes()).and_then(|()| stdin.write_all(b"\n")).and_then(|()| stdin.flush());

        drop(stdin);

        let started = Instant::now();

        while started.elapsed() < Duration::from_secs(5) {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }

            std::thread::sleep(Duration::from_millis(50));
        }

        if matches!(child.try_wait(), Ok(None)) {
            kill_tree(child.id());
        }

        let _ = child.wait();
        let _ = self.pid.compare_exchange(child.id(), 0, Ordering::SeqCst, Ordering::SeqCst);
    }

    /// 엔진이 떠 있고 준비됐는지 확인하고, 아니면 띄워서 ready를 기다린다.
    fn ensure(&self, slot: &mut Option<Proc>) -> Result<(), String> {
        if self.closing.load(Ordering::SeqCst) {
            return Err("앱을 닫는 중이에요.".into());
        }

        let dir = lock(&self.dir).clone();

        if let Some(proc) = slot.as_mut() {
            let alive = matches!(proc.child.try_wait(), Ok(None));

            if alive && proc.dir == dir {
                return Ok(());
            }
        }

        if let Some(old) = slot.take() {
            self.stop_proc(old);
        }

        (self.notify)(State::Starting);

        let result = self.spawn(&dir).and_then(|mut proc| match self.wait_ready(&mut proc) {
            Ok(()) => Ok(proc),
            Err(error) => {
                kill_tree(proc.child.id());
                let _ = proc.child.wait();
                self.pid.store(0, Ordering::SeqCst);

                Err(error)
            }
        });

        match result {
            Ok(proc) => {
                *slot = Some(proc);
                (self.notify)(State::Ready);

                Ok(())
            }
            Err(error) => {
                (self.notify)(State::Failed(error.clone()));

                Err(error)
            }
        }
    }

    fn wait_ready(&self, proc: &mut Proc) -> Result<(), String> {
        let deadline = Instant::now() + self.ready_timeout;

        loop {
            let left = deadline.saturating_duration_since(Instant::now());

            match proc.rx.recv_timeout(left) {
                Ok(Message::Ready) => return Ok(()),
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => return Err("엔진이 너무 오래 준비되지 않아요.".into()),
                Err(RecvTimeoutError::Disconnected) => {
                    // stderr가 로그에 다 쓰일 틈을 준다.
                    std::thread::sleep(Duration::from_millis(300));

                    return Err(format!("엔진이 시작하다 멈췄어요. {}", log_tail(&self.log, 3)));
                }
            }
        }
    }

    /// 요청 하나를 보내고 답을 기다린다. 진행은 `on_step`으로.
    pub fn request(self: &Arc<Self>, cmd: &str, fields: Value, mut on_step: impl FnMut(&str)) -> Result<Value, String> {
        let mut slot = lock(&self.slot);

        self.ensure(&mut slot)?;

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let line = protocol::request(id, cmd, fields);
        let outcome = {
            let Some(proc) = slot.as_mut() else {
                return Err("엔진이 없어요.".into());
            };
            let written = proc.stdin.write_all(line.as_bytes()).and_then(|()| proc.stdin.write_all(b"\n")).and_then(|()| proc.stdin.flush());

            match written {
                Err(_) => None,
                Ok(()) => loop {
                    match proc.rx.recv() {
                        Ok(Message::Step { id: step_id, step }) if step_id == id => on_step(&step),
                        Ok(Message::Reply { id: reply_id, result }) if reply_id == id => break Some(result),
                        Ok(_) => {}
                        Err(_) => break None,
                    }
                },
            }
        };

        match outcome {
            Some(result) => result.map_err(|error| protocol::friendly(&error)),
            None => {
                // 엔진이 죽었다: 남은 것을 치우고, 닫는 중이 아니면 다시 띄운다.
                if let Some(mut dead) = slot.take() {
                    kill_tree(dead.child.id());
                    let _ = dead.child.wait();
                    self.pid.store(0, Ordering::SeqCst);
                }

                drop(slot);

                if self.closing.load(Ordering::SeqCst) {
                    (self.notify)(State::Stopped);

                    return Err("앱을 닫는 중이에요.".into());
                }

                (self.notify)(State::Failed("엔진이 멈춰서 다시 띄우는 중이에요.".into()));
                self.warm();

                Err("엔진이 멈췄어요. 다시 띄우고 있어요.".into())
            }
        }
    }

    /// 앱을 닫을 때: shutdown을 보내고 기다린 뒤, 남아 있으면 그 PID만 닫는다.
    pub fn shutdown(&self) {
        self.closing.store(true, Ordering::SeqCst);

        let started = Instant::now();

        while started.elapsed() < Duration::from_secs(2) {
            if let Ok(mut slot) = self.slot.try_lock() {
                if let Some(proc) = slot.take() {
                    self.stop_proc(proc);
                }

                (self.notify)(State::Stopped);

                return;
            }

            std::thread::sleep(Duration::from_millis(50));
        }

        // 한 장을 처리하는 중이라 잠금을 못 잡았다. 그 PID만 바로 닫는다.
        kill_tree(self.pid.swap(0, Ordering::SeqCst));
        (self.notify)(State::Stopped);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::AtomicUsize;

    /// 진짜 엔진과 같은 규약을 말하는 작은 PowerShell 엔진. "crash"를 받으면 답 없이 죽는다.
    const FAKE: &str = r#"
[Console]::Error.WriteLine('fake engine warming up')
[Console]::Out.WriteLine('{"event":"ready"}'); [Console]::Out.Flush()
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $r = $line | ConvertFrom-Json
  if ($r.cmd -eq 'crash') { exit 3 }
  if ($r.cmd -eq 'shutdown') { [Console]::Out.WriteLine('{"id":' + $r.id + ',"ok":true,"data":null}'); [Console]::Out.Flush(); break }
  if ($r.cmd -eq 'process') {
    foreach ($s in 'detect','ocr','translate','erase','typeset') { [Console]::Out.WriteLine('{"id":' + $r.id + ',"event":"step","step":"' + $s + '"}') }
    [Console]::Out.WriteLine('{"id":' + $r.id + ',"ok":true,"data":{"source":"' + $r.source + '","output":"o","width":2,"height":3,"lines":[]}}'); [Console]::Out.Flush(); continue
  }
  if ($r.cmd -eq 'fail') { [Console]::Out.WriteLine('{"id":' + $r.id + ',"ok":false,"error":"ValueError: bad"}'); [Console]::Out.Flush(); continue }
  [Console]::Out.WriteLine('{"id":' + $r.id + ',"ok":true,"data":"' + $r.cmd + '"}'); [Console]::Out.Flush()
}
"#;

    fn fake(dir: &Path) -> (Arc<Engine>, Arc<Mutex<Vec<State>>>, Arc<AtomicUsize>) {
        let script = dir.join("fake.ps1");

        fs::write(&script, FAKE).unwrap();

        let spawns = Arc::new(AtomicUsize::new(0));
        let counter = spawns.clone();
        let launcher: Launcher = Box::new(move |dir: &Path| {
            counter.fetch_add(1, Ordering::SeqCst);

            Ok(Launch {
                program: PathBuf::from("powershell"),
                args: vec!["-NoProfile".into(), "-NonInteractive".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-File".into(), dir.join("fake.ps1").display().to_string()],
                cwd: dir.to_path_buf(),
            })
        });
        let states = Arc::new(Mutex::new(Vec::new()));
        let seen = states.clone();
        let engine = Engine::new(dir.to_path_buf(), dir.join("logs").join("engine.log"), launcher, Box::new(move |state| lock(&seen).push(state)));

        (engine, states, spawns)
    }

    fn alive(pid: u32) -> bool {
        let output = quiet("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH"]).output().unwrap();

        String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
    }

    #[test]
    fn talks_the_protocol_forwards_steps_and_logs_stderr() {
        let dir = tempfile::tempdir().unwrap();
        let (engine, states, spawns) = fake(dir.path());
        let mut steps = Vec::new();
        let page = engine.request("process", json!({ "source": "a.jpg", "output": "o" }), |step| steps.push(step.to_string())).unwrap();

        assert_eq!(page["source"], "a.jpg");
        assert_eq!(steps, vec!["detect", "ocr", "translate", "erase", "typeset"]);
        assert_eq!(engine.request("status", json!({}), |_| {}).unwrap(), json!("status"));
        assert_eq!(engine.request("fail", json!({}), |_| {}), Err("처리하지 못했어요. (ValueError: bad)".into()));
        assert_eq!(spawns.load(Ordering::SeqCst), 1, "한 엔진을 계속 쓴다");
        assert_eq!(lock(&states).first(), Some(&State::Starting));

        let pid = engine.pid();

        engine.shutdown();
        assert!(!alive(pid), "shutdown 뒤 엔진이 남지 않는다");
        assert_eq!(engine.pid(), 0);
        assert!(fs::read_to_string(dir.path().join("logs").join("engine.log")).unwrap().contains("fake engine warming up"));
        assert!(engine.request("status", json!({}), |_| {}).is_err(), "닫은 뒤에는 요청을 받지 않는다");
    }

    #[test]
    fn a_crash_fails_that_request_and_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let (engine, states, spawns) = fake(dir.path());

        engine.request("status", json!({}), |_| {}).unwrap();

        let first = engine.pid();
        let crashed = engine.request("crash", json!({}), |_| {});

        assert!(crashed.unwrap_err().contains("엔진이 멈췄어요"));
        // 다시 띄운 엔진이 다음 요청을 받는다.
        assert_eq!(engine.request("status", json!({}), |_| {}).unwrap(), json!("status"));
        assert_eq!(spawns.load(Ordering::SeqCst), 2);
        assert_ne!(engine.pid(), first);
        assert!(lock(&states).iter().any(|state| matches!(state, State::Failed(_))));
        engine.shutdown();
    }

    #[test]
    fn changing_the_folder_restarts_with_the_new_one() {
        let dir = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let (engine, _, spawns) = fake(dir.path());

        fs::write(other.path().join("fake.ps1"), FAKE).unwrap();
        engine.request("status", json!({}), |_| {}).unwrap();

        let first = engine.pid();

        engine.set_dir(other.path().to_path_buf());
        engine.request("status", json!({}), |_| {}).unwrap();
        assert_eq!(spawns.load(Ordering::SeqCst), 2);
        assert!(!alive(first), "앞 엔진은 닫았다");
        engine.shutdown();
    }

    #[test]
    fn a_missing_engine_says_so_in_korean() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Engine::new(dir.path().to_path_buf(), dir.path().join("engine.log"), python_launcher(), Box::new(|_| {}));
        let error = engine.request("status", json!({}), |_| {}).unwrap_err();

        assert!(error.contains("엔진을 찾지 못했어요"), "{error}");
    }
}
