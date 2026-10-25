//! 설정과 앱 데이터 폴더. 데이터는 %APPDATA%\ChoiManga 에 둔다(CHOIMANGA_DATA_DIR로 바꿀 수 있다, 테스트용).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const DEFAULT_MODEL: &str = "ko-edit";
pub const DEFAULT_FONT: &str = r"C:\Windows\Fonts\malgunbd.ttf";
pub const DEFAULT_SCALE: f64 = 0.92;
/// 글자 크기 단계: 아주 작게, 작게, 보통, 크게.
pub const SCALES: [f64; 4] = [0.7, 0.82, 0.92, 1.05];

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SaveMode {
    /// 원본 폴더 옆 `<폴더이름>_ko`, 파일 하나면 원본 폴더 안 `ko`.
    #[default]
    Beside,
    /// 고른 폴더 한 곳.
    Fixed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub model: String,
    pub font: String,
    pub scale: f64,
    pub save_mode: SaveMode,
    pub fixed_folder: String,
    pub auto_start: bool,
    pub engine_dir: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            model: DEFAULT_MODEL.into(),
            font: DEFAULT_FONT.into(),
            scale: DEFAULT_SCALE,
            save_mode: SaveMode::Beside,
            fixed_folder: String::new(),
            auto_start: true,
            engine_dir: default_engine_dir().display().to_string(),
        }
    }
}

pub fn default_engine_dir() -> PathBuf {
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Users\main"));

    home.join("Desktop").join("choimanga").join("engine")
}

pub fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("CHOIMANGA_DATA_DIR") {
        return PathBuf::from(dir);
    }

    let roaming = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);

    roaming.join("ChoiManga")
}

/// 가장 가까운 글자 크기 단계.
pub fn snap_scale(scale: f64) -> f64 {
    if !scale.is_finite() {
        return DEFAULT_SCALE;
    }

    SCALES.iter().copied().fold(DEFAULT_SCALE, |best, step| if (step - scale).abs() < (best - scale).abs() { step } else { best })
}

/// 빈 값은 기본값으로, 글자 크기는 단계로 다듬는다. 고정 폴더가 비면 원본 옆에 저장한다.
pub fn clean(mut settings: Settings) -> Settings {
    if settings.model.trim().is_empty() {
        settings.model = DEFAULT_MODEL.into();
    }

    if settings.font.trim().is_empty() {
        settings.font = DEFAULT_FONT.into();
    }

    if settings.engine_dir.trim().is_empty() {
        settings.engine_dir = default_engine_dir().display().to_string();
    }

    settings.scale = snap_scale(settings.scale);

    if settings.save_mode == SaveMode::Fixed && settings.fixed_folder.trim().is_empty() {
        settings.save_mode = SaveMode::Beside;
    }

    settings
}

/// 읽지 못하면 기본값.
pub fn load(dir: &Path) -> Settings {
    let settings = fs::read_to_string(dir.join("settings.json")).ok().and_then(|text| serde_json::from_str::<Settings>(&text).ok()).unwrap_or_default();

    clean(settings)
}

pub fn save(dir: &Path, settings: &Settings) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| error.to_string())?;

    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    let path = dir.join("settings.json");
    let temp = path.with_extension("tmp");

    // 반쯤 쓴 파일이 남지 않게 옆에 쓰고 바꿔 끼운다.
    fs::write(&temp, text).map_err(|error| error.to_string())?;
    fs::rename(&temp, &path).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_gives_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let settings = load(dir.path());

        assert_eq!(settings.model, "ko-edit");
        assert_eq!(settings.font, DEFAULT_FONT);
        assert_eq!(settings.scale, 0.92);
        assert_eq!(settings.save_mode, SaveMode::Beside);
        assert!(settings.auto_start);
        assert!(settings.engine_dir.ends_with(r"Desktop\choimanga\engine"));
    }

    #[test]
    fn scale_snaps_to_steps() {
        assert_eq!(snap_scale(0.71), 0.7);
        assert_eq!(snap_scale(0.8), 0.82);
        assert_eq!(snap_scale(0.92), 0.92);
        assert_eq!(snap_scale(3.0), 1.05);
        assert_eq!(snap_scale(f64::NAN), 0.92);
    }

    #[test]
    fn save_and_load_round_trip_and_clean() {
        let dir = tempfile::tempdir().unwrap();
        let settings = Settings {
            model: " ".into(),
            font: r"C:\Windows\Fonts\malgun.ttf".into(),
            scale: 1.05,
            save_mode: SaveMode::Fixed,
            fixed_folder: String::new(),
            auto_start: false,
            engine_dir: r"D:\엔진".into(),
        };

        save(dir.path(), &settings).unwrap();

        let loaded = load(dir.path());

        assert_eq!(loaded.model, "ko-edit");
        assert_eq!(loaded.font, r"C:\Windows\Fonts\malgun.ttf");
        assert_eq!(loaded.scale, 1.05);
        // 고정 폴더가 비었으니 원본 옆으로.
        assert_eq!(loaded.save_mode, SaveMode::Beside);
        assert!(!loaded.auto_start);
        assert_eq!(loaded.engine_dir, r"D:\엔진");
    }

    #[test]
    fn partial_file_keeps_other_defaults() {
        let dir = tempfile::tempdir().unwrap();

        fs::write(dir.path().join("settings.json"), r#"{ "saveMode": "fixed", "fixedFolder": "E:\\번역" }"#).unwrap();

        let loaded = load(dir.path());

        assert_eq!(loaded.save_mode, SaveMode::Fixed);
        assert_eq!(loaded.fixed_folder, r"E:\번역");
        assert!(loaded.auto_start);
        assert_eq!(loaded.scale, 0.92);
    }
}
