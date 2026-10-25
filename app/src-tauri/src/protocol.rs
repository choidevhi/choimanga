//! 엔진(engine\choimanga\server.py)과 주고받는 JSON 한 줄. 요청은 `{"id","cmd",...}`,
//! 답은 `{"id","ok","data"|"error"}`, 진행은 `{"id","event":"step","step"}`, 시작은 `{"event":"ready"}`.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::settings::Settings;

#[derive(Debug, Clone, PartialEq)]
pub enum Message {
    Ready,
    Step { id: u64, step: String },
    Reply { id: u64, result: Result<Value, String> },
}

#[derive(Deserialize)]
struct Raw {
    id: Option<u64>,
    event: Option<String>,
    step: Option<String>,
    ok: Option<bool>,
    data: Option<Value>,
    error: Option<String>,
}

/// 한 줄을 읽는다. 엔진 말이 아니면 None.
pub fn parse(line: &str) -> Option<Message> {
    let raw: Raw = serde_json::from_str(line.trim()).ok()?;

    match (raw.event.as_deref(), raw.id, raw.ok) {
        (Some("ready"), _, _) => Some(Message::Ready),
        (Some("step"), Some(id), _) => Some(Message::Step { id, step: raw.step.unwrap_or_default() }),
        (None, Some(id), Some(true)) => Some(Message::Reply { id, result: Ok(raw.data.unwrap_or(Value::Null)) }),
        (None, Some(id), Some(false)) => Some(Message::Reply { id, result: Err(raw.error.unwrap_or_else(|| "알 수 없는 오류".into())) }),
        _ => None,
    }
}

pub fn options(settings: &Settings) -> Value {
    json!({ "model": settings.model, "font": settings.font, "scale": settings.scale })
}

pub fn request(id: u64, cmd: &str, mut fields: Value) -> String {
    if let Value::Object(map) = &mut fields {
        map.insert("id".into(), json!(id));
        map.insert("cmd".into(), json!(cmd));
    } else {
        fields = json!({ "id": id, "cmd": cmd });
    }

    fields.to_string()
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Line {
    #[serde(rename = "box")]
    pub area: [f64; 4],
    pub vertical: bool,
    pub japanese: String,
    pub korean: String,
    #[serde(default)]
    pub letter: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Page {
    pub source: String,
    pub output: String,
    pub width: u32,
    pub height: u32,
    pub lines: Vec<Line>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Status {
    pub device: String,
    pub gpu: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    pub ollama: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Font {
    pub path: String,
    pub name: String,
}

/// 엔진이 돌려준 data를 정해진 모양으로 읽는다.
pub fn decode<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|error| format!("엔진 답을 읽지 못했어요: {error}"))
}

/// 엔진의 영어 오류를 화면에 보일 한국어로.
pub fn friendly(error: &str) -> String {
    let lower = error.to_lowercase();

    if lower.contains("out of memory") {
        return "그래픽 메모리가 모자라요. 다른 프로그램을 닫고 다시 해 주세요.".into();
    }

    if lower.contains("connection refused") || lower.contains("urlopen error") || lower.contains("ollama") {
        return "Ollama에 연결하지 못했어요. Ollama를 켜고 다시 해 주세요.".into();
    }

    if lower.contains("filenotfounderror") || lower.contains("no such file") {
        return "그림 파일을 찾지 못했어요. 옮기거나 지웠는지 확인해 주세요.".into();
    }

    if lower.contains("unidentifiedimageerror") || lower.contains("cannot identify image") {
        return "그림 파일을 읽지 못했어요.".into();
    }

    format!("처리하지 못했어요. ({error})")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_kind_of_line() {
        assert_eq!(parse(r#"{"event":"ready"}"#), Some(Message::Ready));
        assert_eq!(parse(r#"{"id": 3, "event": "step", "step": "ocr"}"#), Some(Message::Step { id: 3, step: "ocr".into() }));
        assert_eq!(parse(r#"{"id": 4, "ok": true, "data": null}"#), Some(Message::Reply { id: 4, result: Ok(Value::Null) }));
        assert_eq!(parse(r#"{"id": 5, "ok": false, "error": "ValueError: x"}"#), Some(Message::Reply { id: 5, result: Err("ValueError: x".into()) }));
        assert_eq!(parse("Loading model..."), None);
        assert_eq!(parse(r#"{"something":"else"}"#), None);
    }

    #[test]
    fn builds_requests_with_id_and_cmd() {
        let text = request(7, "process", json!({ "source": "a.jpg", "output": "ko\\a.jpg", "options": options(&Settings::default()) }));
        let value: Value = serde_json::from_str(&text).unwrap();

        assert!(!text.contains('\n'));
        assert_eq!(value["id"], 7);
        assert_eq!(value["cmd"], "process");
        assert_eq!(value["options"]["model"], "ko-edit");
        assert_eq!(value["options"]["scale"], 0.92);
        assert_eq!(request(1, "status", Value::Null), r#"{"cmd":"status","id":1}"#);
    }

    #[test]
    fn decodes_a_page() {
        let value = json!({
            "source": "p1.jpg", "output": "ko\\p1.jpg", "width": 800, "height": 1100,
            "lines": [{ "box": [564, 155, 657, 467], "vertical": true, "japanese": "ちょっと待って", "korean": "잠깐만", "letter": 40.2 }]
        });
        let page: Page = decode(value).unwrap();

        assert_eq!(page.lines[0].area, [564.0, 155.0, 657.0, 467.0]);
        assert_eq!(serde_json::to_value(&page).unwrap()["lines"][0]["box"][0], 564.0);
        assert!(decode::<Page>(json!({ "source": 1 })).is_err());
    }

    #[test]
    fn errors_become_korean() {
        assert!(friendly("OutOfMemoryError: CUDA out of memory").contains("그래픽 메모리"));
        assert!(friendly("URLError: <urlopen error [WinError 10061]>").contains("Ollama"));
        assert!(friendly("FileNotFoundError: [Errno 2] No such file").contains("찾지 못했어요"));
        assert!(friendly("ValueError: odd").contains("ValueError: odd"));
    }
}
