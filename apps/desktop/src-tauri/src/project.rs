//! Writing an engine's generated project to disk.

use std::fs;
use std::io;
use std::path::{Component, Path};

use serde::Deserialize;

/// One generated file, as the editor's generator produces it.
#[derive(Debug, Deserialize)]
pub struct ProjectFile {
    pub path: String,
    pub contents: String,
}

/// A folder name from an engine name: letters, digits, `-` and `_`.
pub fn safe_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "engine".into()
    } else {
        s
    }
}

/// Only plain relative paths inside the project (no `..`, no absolute paths).
fn is_safe(path: &str) -> bool {
    let p = Path::new(path);
    !path.is_empty() && p.components().all(|c| matches!(c, Component::Normal(_)))
}

/// Writes `files` into `dir`. Files are only rewritten when they changed (so
/// cargo doesn't rebuild for nothing), and `.rs` files under `src/` that the
/// engine no longer has are removed. `target/` and anything else are kept.
pub fn write(dir: &Path, files: &[ProjectFile]) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    for f in files {
        if !is_safe(&f.path) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("unsafe path {}", f.path),
            ));
        }
        let path = dir.join(&f.path);
        if fs::read_to_string(&path).ok().as_deref() == Some(f.contents.as_str()) {
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, &f.contents)?;
    }
    let src = dir.join("src");
    if src.is_dir() {
        for entry in fs::read_dir(&src)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let rel = format!("src/{name}");
            if name.ends_with(".rs") && !files.iter().any(|f| f.path == rel) {
                fs::remove_file(entry.path())?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, contents: &str) -> ProjectFile {
        ProjectFile {
            path: path.into(),
            contents: contents.into(),
        }
    }

    #[test]
    fn writes_files_and_removes_old_sources() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            &[
                file("Cargo.toml", "x"),
                file("src/main.rs", "a"),
                file("src/tt.rs", "b"),
            ],
        )
        .unwrap();
        assert!(dir.path().join("src/tt.rs").exists());
        fs::create_dir_all(dir.path().join("target")).unwrap();
        write(
            dir.path(),
            &[file("Cargo.toml", "x"), file("src/main.rs", "a2")],
        )
        .unwrap();
        assert!(
            !dir.path().join("src/tt.rs").exists(),
            "tt.rs is gone with the TT block"
        );
        assert_eq!(
            fs::read_to_string(dir.path().join("src/main.rs")).unwrap(),
            "a2"
        );
        assert!(dir.path().join("target").exists(), "target/ is kept");
    }

    #[test]
    fn refuses_paths_outside_the_project() {
        let dir = tempfile::tempdir().unwrap();
        assert!(write(dir.path(), &[file("../evil.rs", "x")]).is_err());
        assert!(write(dir.path(), &[file("/etc/evil", "x")]).is_err());
    }

    #[test]
    fn folder_names_are_safe() {
        assert_eq!(safe_name("My Engine!"), "My-Engine");
        assert_eq!(safe_name("../.."), "engine");
    }
}
