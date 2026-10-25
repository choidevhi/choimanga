//! 넣은 파일·폴더를 그림 목록으로 펼치고, 장마다 번역본을 쓸 곳을 정한다.

use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::settings::{SaveMode, Settings};

pub const IMAGE_EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];
/// 엔진이 출력 옆에 남기는 다시 쓰기용 작업 폴더.
pub const WORK_FOLDER: &str = ".choimanga";

/// 목록에 넣을 한 장. `root`는 넣은 폴더(파일을 하나씩 넣었으면 없음).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub source: PathBuf,
    pub root: Option<PathBuf>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub source: String,
    pub output: String,
    pub name: String,
}

pub fn is_image(path: &Path) -> bool {
    path.extension().and_then(|extension| extension.to_str()).is_some_and(|extension| IMAGE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
}

/// 이미 번역한 것이 든 폴더: 작업 폴더, 파일 하나 번역본의 `ko`, 폴더 번역본의 `<이름>_ko`.
pub fn is_skipped_folder(name: &str) -> bool {
    let lower = name.to_lowercase();

    lower == WORK_FOLDER || lower == "ko" || lower.ends_with("_ko")
}

fn inside_work_folder(path: &Path) -> bool {
    path.components().any(|part| part.as_os_str().to_string_lossy().eq_ignore_ascii_case(WORK_FOLDER))
}

fn chunks(text: &str) -> Vec<(bool, String)> {
    let mut parts: Vec<(bool, String)> = Vec::new();

    for character in text.chars() {
        let digit = character.is_ascii_digit();

        match parts.last_mut() {
            Some((kind, part)) if *kind == digit => part.push(character),
            _ => parts.push((digit, character.to_string())),
        }
    }

    parts
}

/// 자연 정렬: 숫자는 수로(1, 2, 10), 글자는 대소문자 없이 비교한다.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let left = chunks(a);
    let right = chunks(b);

    for ((left_digit, left_part), (right_digit, right_part)) in left.iter().zip(right.iter()) {
        let order = if *left_digit && *right_digit {
            let left_trimmed = left_part.trim_start_matches('0');
            let right_trimmed = right_part.trim_start_matches('0');

            left_trimmed.len().cmp(&right_trimmed.len()).then_with(|| left_trimmed.cmp(right_trimmed)).then_with(|| left_part.len().cmp(&right_part.len()))
        } else {
            left_part.to_lowercase().cmp(&right_part.to_lowercase())
        };

        if order != Ordering::Equal {
            return order;
        }
    }

    left.len().cmp(&right.len()).then_with(|| a.cmp(b))
}

/// 경로를 부분(폴더, 파일 이름)마다 자연 정렬로 비교한다.
pub fn path_cmp(a: &Path, b: &Path) -> Ordering {
    let left: Vec<String> = a.components().map(|part| part.as_os_str().to_string_lossy().into_owned()).collect();
    let right: Vec<String> = b.components().map(|part| part.as_os_str().to_string_lossy().into_owned()).collect();

    for (left_part, right_part) in left.iter().zip(right.iter()) {
        let order = natural_cmp(left_part, right_part);

        if order != Ordering::Equal {
            return order;
        }
    }

    left.len().cmp(&right.len())
}

fn walk(dir: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.map_while(Result::ok) {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };

        if kind.is_dir() {
            if !is_skipped_folder(&entry.file_name().to_string_lossy()) {
                walk(&path, found);
            }
        } else if kind.is_file() && is_image(&path) {
            found.push(path);
        }
    }
}

/// 넣은 경로들을 그림 목록으로. 따로 넣은 파일이 먼저(자연 정렬), 그다음 폴더마다 하위 폴더까지 자연 정렬.
pub fn expand(paths: &[PathBuf]) -> Vec<Found> {
    let mut files: Vec<PathBuf> = Vec::new();
    let mut folders: Vec<PathBuf> = Vec::new();

    for path in paths {
        if path.is_dir() {
            folders.push(path.clone());
        } else if path.is_file() && is_image(path) && !inside_work_folder(path) {
            files.push(path.clone());
        }
    }

    files.sort_by(|a, b| path_cmp(a, b));
    folders.sort_by(|a, b| path_cmp(a, b));

    let mut seen = HashSet::new();
    let mut result = Vec::new();

    for file in files {
        if seen.insert(file.clone()) {
            result.push(Found { source: file, root: None });
        }
    }

    for folder in folders {
        let mut inside = Vec::new();

        walk(&folder, &mut inside);
        inside.sort_by(|a, b| path_cmp(a.strip_prefix(&folder).unwrap_or(a), b.strip_prefix(&folder).unwrap_or(b)));

        for file in inside {
            if seen.insert(file.clone()) {
                result.push(Found { source: file, root: Some(folder.clone()) });
            }
        }
    }

    result
}

fn folder_name(folder: &Path) -> String {
    folder.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "만화".into())
}

/// 번역본 경로.
/// - 원본 옆(기본): 폴더를 넣었으면 그 폴더 옆 `<폴더이름>_ko\<폴더 안 경로>`, 파일이면 같은 폴더 안 `ko\<파일 이름>`.
/// - 고정 폴더: 폴더면 `<고정>\<폴더이름>_ko\<폴더 안 경로>`, 파일이면 `<고정>\<파일 이름>`.
pub fn output_for(found: &Found, settings: &Settings) -> PathBuf {
    let file_name = found.source.file_name().map(PathBuf::from).unwrap_or_default();
    let fixed = PathBuf::from(settings.fixed_folder.trim());

    match (&found.root, settings.save_mode) {
        (Some(root), mode) => {
            let relative = found.source.strip_prefix(root).map(Path::to_path_buf).unwrap_or(file_name);
            let base = match mode {
                SaveMode::Beside => root.parent().map(Path::to_path_buf).unwrap_or_else(|| root.clone()),
                SaveMode::Fixed => fixed,
            };

            base.join(format!("{}_ko", folder_name(root))).join(relative)
        }
        (None, SaveMode::Beside) => found.source.parent().map(|parent| parent.join("ko")).unwrap_or_else(|| PathBuf::from("ko")).join(file_name),
        (None, SaveMode::Fixed) => fixed.join(file_name),
    }
}

pub fn items(paths: &[PathBuf], settings: &Settings) -> Vec<Item> {
    expand(paths)
        .into_iter()
        .map(|found| Item {
            output: output_for(&found, settings).display().to_string(),
            name: found.source.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
            source: found.source.display().to_string(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    fn names(found: &[Found], root: &Path) -> Vec<String> {
        found.iter().map(|item| item.source.strip_prefix(root).unwrap().display().to_string()).collect()
    }

    #[test]
    fn natural_order_counts_numbers() {
        let mut list = vec!["10.jpg", "2.jpg", "1.jpg", "P3.png", "p20.png", "02.jpg"];

        list.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(list, vec!["1.jpg", "2.jpg", "02.jpg", "10.jpg", "P3.png", "p20.png"]);
    }

    #[test]
    fn image_extensions_ignore_case() {
        assert!(is_image(Path::new("a.JPG")));
        assert!(is_image(Path::new("a.jpeg")));
        assert!(is_image(Path::new("a.webp")));
        assert!(is_image(Path::new("a.Png")));
        assert!(!is_image(Path::new("a.gif")));
        assert!(!is_image(Path::new("a")));
    }

    #[test]
    fn folder_expands_recursively_sorted_and_skips_outputs() {
        let dir = tempfile::tempdir().unwrap();
        let book = dir.path().join("만화");

        for name in ["10.jpg", "2.jpg", "1.png", "notes.txt", "1권/3.webp", "1권/1.jpeg", "2권/1.jpg", "ko/1.jpg", "1권_ko/1.jpg", ".choimanga/1.clean.png"] {
            touch(&book.join(name));
        }

        let found = expand(std::slice::from_ref(&book));

        assert_eq!(names(&found, &book), vec!["1.png", "1권\\1.jpeg", "1권\\3.webp", "2.jpg", "2권\\1.jpg", "10.jpg"]);
        assert!(found.iter().all(|item| item.root.as_deref() == Some(book.as_path())));
    }

    #[test]
    fn loose_files_come_first_and_duplicates_once() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("p10.jpg");
        let b = dir.path().join("p2.jpg");
        let folder = dir.path().join("책");
        let work = dir.path().join("ko").join(".choimanga").join("p1.clean.png");

        touch(&a);
        touch(&b);
        touch(&folder.join("1.jpg"));
        touch(&work);

        let found = expand(&[folder.clone(), a.clone(), b.clone(), a.clone(), work]);

        assert_eq!(found.iter().map(|item| item.source.clone()).collect::<Vec<_>>(), vec![b, a, folder.join("1.jpg")]);
        assert_eq!(found[0].root, None);
    }

    #[test]
    fn output_paths_follow_the_spec() {
        let beside = Settings::default();
        let fixed = Settings { save_mode: SaveMode::Fixed, fixed_folder: r"E:\번역".into(), ..Settings::default() };
        let file = Found { source: PathBuf::from(r"D:\manga\p1.jpg"), root: None };
        let in_folder = Found { source: PathBuf::from(r"D:\manga\책\1권\003.png"), root: Some(PathBuf::from(r"D:\manga\책")) };

        assert_eq!(output_for(&file, &beside), PathBuf::from(r"D:\manga\ko\p1.jpg"));
        assert_eq!(output_for(&in_folder, &beside), PathBuf::from(r"D:\manga\책_ko\1권\003.png"));
        assert_eq!(output_for(&file, &fixed), PathBuf::from(r"E:\번역\p1.jpg"));
        assert_eq!(output_for(&in_folder, &fixed), PathBuf::from(r"E:\번역\책_ko\1권\003.png"));
    }

    #[test]
    fn items_carry_names_and_outputs() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("koma_orig.jpg");

        touch(&file);

        let list = items(&[file], &Settings::default());

        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "koma_orig.jpg");
        assert_eq!(PathBuf::from(&list[0].output), dir.path().join("ko").join("koma_orig.jpg"));
    }
}
