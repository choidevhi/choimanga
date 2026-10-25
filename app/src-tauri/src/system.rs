//! 탐색기 열기와 Ollama 켜기. 콘솔 창 없이 띄운다.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

pub fn ollama_app() -> PathBuf {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Users\main\AppData\Local"));

    local.join("Programs").join("Ollama").join("ollama app.exe")
}

/// Ollama 앱을 이 앱과 떨어진 프로세스로 띄운다(이 앱을 닫아도 계속 돈다).
pub fn start_ollama() -> Result<(), String> {
    let app = ollama_app();

    if !app.is_file() {
        return Err(format!("Ollama를 찾지 못했어요({}).", app.display()));
    }

    let mut command = Command::new(&app);

    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());

    #[cfg(windows)]
    command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);

    command.spawn().map(|_| ()).map_err(|error| format!("Ollama를 켜지 못했어요: {error}"))
}

/// 탐색기에서 파일을 골라 둔 채로 폴더를 연다.
pub fn reveal(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("파일을 찾지 못했어요. 옮기거나 지웠는지 확인해 주세요.".into());
    }

    let mut command = Command::new("explorer");

    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
        command.raw_arg(format!("/select,\"{}\"", path.display()));
    }

    command.spawn().map(|_| ()).map_err(|error| error.to_string())
}

const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;

fn is_hidden(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;

        std::fs::metadata(path).map(|meta| meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0).unwrap_or(false)
    }

    #[cfg(not(windows))]
    {
        let _ = path;

        true
    }
}

/// 엔진이 출력 옆에 남기는 `.choimanga` 작업 폴더를 숨김으로 해서 탐색기 목록에 보이지 않게 한다.
pub fn hide_work_folder(output: &Path) {
    let Some(work) = output.parent().map(|parent| parent.join(crate::paths::WORK_FOLDER)) else {
        return;
    };

    if !work.is_dir() || is_hidden(&work) {
        return;
    }

    let mut command = Command::new("attrib");

    command.arg("+h").arg(&work).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let _ = command.status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn work_folder_becomes_hidden() {
        let dir = tempfile::tempdir().unwrap();
        let work = dir.path().join("ko").join(".choimanga");

        std::fs::create_dir_all(&work).unwrap();
        assert!(!is_hidden(&work));
        hide_work_folder(&dir.path().join("ko").join("p1.jpg"));
        assert!(is_hidden(&work));
        // 작업 폴더가 없으면 아무것도 하지 않는다.
        hide_work_folder(&dir.path().join("없음").join("p1.jpg"));
    }

    #[test]
    fn ollama_lives_under_local_app_data() {
        assert!(ollama_app().ends_with(r"Programs\Ollama\ollama app.exe"));
    }
}
