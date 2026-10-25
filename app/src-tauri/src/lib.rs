mod engine;
mod paths;
mod protocol;
mod settings;
mod system;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use engine::{Engine, State as EngineState};
use protocol::{Font, Page, Status};
use serde::Serialize;
use serde_json::json;
use settings::Settings;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

struct Core {
    data: PathBuf,
    settings: Mutex<Settings>,
    engine: Arc<Engine>,
    engine_state: Arc<Mutex<EngineState>>,
}

impl Core {
    fn settings(&self) -> Settings {
        self.settings.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

type Shared = Arc<Core>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Boot {
    version: &'static str,
    settings: Settings,
    defaults: Settings,
    engine: EngineState,
    log: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StepEvent {
    job: u64,
    step: String,
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn boot(core: State<'_, Shared>) -> Boot {
    Boot {
        version: env!("CARGO_PKG_VERSION"),
        settings: core.settings(),
        defaults: Settings::default(),
        engine: core.engine_state.lock().unwrap_or_else(PoisonError::into_inner).clone(),
        log: core.data.join("engine.log").display().to_string(),
    }
}

#[tauri::command]
fn save_settings(core: State<'_, Shared>, settings: Settings) -> Result<Settings, String> {
    let next = settings::clean(settings);

    settings::save(&core.data, &next)?;
    *core.settings.lock().unwrap_or_else(PoisonError::into_inner) = next.clone();
    core.engine.set_dir(PathBuf::from(&next.engine_dir));

    Ok(next)
}

#[tauri::command]
async fn engine_status(core: State<'_, Shared>) -> Result<Status, String> {
    let engine = core.engine.clone();

    blocking(move || protocol::decode(engine.request("status", json!({}), |_| {})?)).await
}

#[tauri::command]
async fn engine_fonts(core: State<'_, Shared>) -> Result<Vec<Font>, String> {
    let engine = core.engine.clone();

    blocking(move || protocol::decode(engine.request("fonts", json!({}), |_| {})?)).await
}

/// 한 장을 번역한다. 진행은 "step" 이벤트({job, step})로 보낸다.
#[tauri::command]
async fn process_page(app: AppHandle, core: State<'_, Shared>, job: u64, source: String, output: String) -> Result<Page, String> {
    let engine = core.engine.clone();
    let options = protocol::options(&core.settings());

    if PathBuf::from(&source) == PathBuf::from(&output) {
        return Err("번역본이 원본을 덮어쓰게 돼요. 저장 위치를 바꿔 주세요.".into());
    }

    blocking(move || {
        let output_path = output.clone();
        let fields = json!({ "source": source, "output": output, "options": options });
        let value = engine
            .request("process", fields, |step| {
                let _ = app.emit("step", StepEvent { job, step: step.to_string() });
            })?;

        system::hide_work_folder(&PathBuf::from(&output_path));
        protocol::decode(value)
    })
    .await
}

/// 번역문(같은 순서)이나 글자 크기·글꼴만 바꿔 다시 쓴다. korean이 없으면 글자 크기·글꼴만.
#[tauri::command]
async fn retypeset_page(core: State<'_, Shared>, output: String, korean: Option<Vec<String>>) -> Result<Page, String> {
    let engine = core.engine.clone();
    let options = protocol::options(&core.settings());

    blocking(move || {
        let value = engine.request("retypeset", json!({ "output": output, "korean": korean, "options": options }), |_| {})?;

        protocol::decode(value)
    })
    .await
}

#[tauri::command]
fn expand_paths(core: State<'_, Shared>, paths: Vec<String>) -> Vec<paths::Item> {
    let list: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();

    paths::items(&list, &core.settings())
}

#[tauri::command]
async fn pick_files(app: AppHandle) -> Result<Vec<String>, String> {
    let picked = app.dialog().file().set_title("번역할 그림 고르기").add_filter("그림", &paths::IMAGE_EXTENSIONS).blocking_pick_files();
    let list = picked.unwrap_or_default().into_iter().filter_map(|path| path.into_path().ok()).map(|path| path.display().to_string()).collect();

    Ok(list)
}

#[tauri::command]
async fn pick_folder(app: AppHandle, title: String, start: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file().set_title(title);

    if let Some(start) = start.filter(|start| !start.trim().is_empty()) {
        dialog = dialog.set_directory(start);
    }

    let picked = dialog.blocking_pick_folder();

    Ok(picked.and_then(|path| path.into_path().ok()).map(|path| path.display().to_string()))
}

/// 지금 떠 있는 엔진의 PID(없으면 0). 시험에서 엔진이 하나뿐인지, 닫은 뒤 남지 않는지 볼 때 쓴다.
#[tauri::command]
fn engine_pid(core: State<'_, Shared>) -> u32 {
    core.engine.pid()
}

#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    system::reveal(&PathBuf::from(path))
}

#[tauri::command]
fn start_ollama() -> Result<(), String> {
    system::start_ollama()
}

/// 테스트(CDP)로 띄웠을 때는 같은 임시 웹뷰 데이터 폴더와 원격 디버깅 포트를 쓴다.
fn webview_env<'a, R: tauri::Runtime, M: Manager<R>>(builder: WebviewWindowBuilder<'a, R, M>) -> WebviewWindowBuilder<'a, R, M> {
    match std::env::var("CHOIMANGA_CDP_PORT").ok().and_then(|text| text.parse::<u16>().ok()) {
        Some(port) => builder
            .additional_browser_args(&format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port={port}"))
            .data_directory(std::env::temp_dir().join("choimanga-cdp")),
        None => builder,
    }
}

fn open_main_window(app: &tauri::App) -> tauri::Result<()> {
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("ChoiManga")
        .inner_size(1280.0, 820.0)
        .min_inner_size(960.0, 640.0)
        .center();

    webview_env(builder).build()?;

    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = settings::data_dir();
            let loaded = settings::load(&data);
            let handle = app.handle().clone();
            let engine_state = Arc::new(Mutex::new(EngineState::Starting));
            let remembered = engine_state.clone();
            let notify = move |state: EngineState| {
                *remembered.lock().unwrap_or_else(PoisonError::into_inner) = state.clone();
                let _ = handle.emit("engine", state);
            };
            let engine = Engine::new(PathBuf::from(&loaded.engine_dir), data.join("engine.log"), engine::python_launcher(), Box::new(notify));
            let core = Arc::new(Core { data, settings: Mutex::new(loaded), engine: engine.clone(), engine_state });

            app.manage(core);
            open_main_window(app)?;
            engine.warm();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            boot,
            save_settings,
            engine_status,
            engine_fonts,
            engine_pid,
            process_page,
            retypeset_page,
            expand_paths,
            pick_files,
            pick_folder,
            reveal,
            start_ollama
        ])
        .build(tauri::generate_context!())
        .expect("ChoiManga를 시작하지 못했습니다");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(core) = handle.try_state::<Shared>() {
                core.engine.shutdown();
            }
        }
    });
}
