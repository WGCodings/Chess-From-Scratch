//! Building an engine with cargo and running it.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use serde::Serialize;

/// The `cargo` program: from PATH, or from `~/.cargo/bin` (apps started from
/// a desktop menu often don't get the shell's PATH).
pub fn cargo() -> PathBuf {
    let exe = if cfg!(windows) { "cargo.exe" } else { "cargo" };
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let p = dir.join(exe);
            if p.is_file() {
                return p;
            }
        }
    }
    let home =
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    if let Some(p) = home
        .map(|h| h.join(".cargo").join("bin").join(exe))
        .filter(|p| p.is_file())
    {
        return p;
    }
    PathBuf::from(exe)
}

/// A command that doesn't open a console window on Windows.
fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

pub fn cargo_version() -> Result<String, String> {
    let out = command(cargo()).arg("--version").output().map_err(|_| {
        "Rust is not installed (cargo was not found). Install it from https://rustup.rs".to_string()
    })?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The program `cargo build --release` makes in `dir`.
pub fn program_path(dir: &Path) -> Result<PathBuf, String> {
    let toml = std::fs::read_to_string(dir.join("Cargo.toml"))
        .map_err(|e| format!("No Cargo.toml in {}: {e}", dir.display()))?;
    let name = toml
        .lines()
        .find_map(|l| {
            l.trim()
                .strip_prefix("name = \"")
                .and_then(|r| r.strip_suffix('"'))
        })
        .ok_or("Cargo.toml has no package name")?;
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    Ok(dir.join("target").join("release").join(exe))
}

/// Runs `cargo build --release` in `dir`, calling `on_line` for every line it
/// prints (cargo writes its progress to stderr). Returns the program's path.
pub fn build(
    dir: &Path,
    on_line: impl Fn(String) + Send + Sync + 'static,
) -> Result<String, String> {
    let mut child = command(cargo())
        .args(["build", "--release", "--color", "never"])
        .current_dir(dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!("Could not start cargo: {e}. Is Rust installed? See https://rustup.rs")
        })?;
    let on_line = std::sync::Arc::new(on_line);
    let out = child.stdout.take().unwrap();
    let err = child.stderr.take().unwrap();
    let a = {
        let f = on_line.clone();
        thread::spawn(move || {
            BufReader::new(out)
                .lines()
                .map_while(Result::ok)
                .for_each(|l| f(l))
        })
    };
    let b = {
        let f = on_line.clone();
        thread::spawn(move || {
            BufReader::new(err)
                .lines()
                .map_while(Result::ok)
                .for_each(|l| f(l))
        })
    };
    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = a.join();
    let _ = b.join();
    if !status.success() {
        return Err("The build failed; the errors are above.".into());
    }
    Ok(program_path(dir)?.to_string_lossy().into_owned())
}

/// What the running engine says.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "kind", content = "text", rename_all = "lowercase")]
pub enum EngineEvent {
    /// A line the engine printed.
    Line(String),
    /// The engine stopped (with its exit code, if any).
    Exit(String),
}

struct Running {
    child: Child,
    stdin: ChildStdin,
}

/// The engine the user is talking to (one at a time).
#[derive(Default)]
pub struct Engines {
    running: Mutex<Option<Running>>,
}

impl Engines {
    pub fn start(
        &self,
        program: &Path,
        dir: &Path,
        on_event: impl Fn(EngineEvent) + Send + Sync + 'static,
    ) -> Result<(), String> {
        self.stop();
        let mut child = command(program)
            .current_dir(dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not start {}: {e}", program.display()))?;
        let stdin = child.stdin.take().unwrap();
        let out = child.stdout.take().unwrap();
        let err = child.stderr.take().unwrap();
        let on_event = std::sync::Arc::new(on_event);
        {
            let f = on_event.clone();
            thread::spawn(move || {
                BufReader::new(err)
                    .lines()
                    .map_while(Result::ok)
                    .for_each(|l| f(EngineEvent::Line(l)))
            });
        }
        {
            let f = on_event.clone();
            thread::spawn(move || {
                BufReader::new(out)
                    .lines()
                    .map_while(Result::ok)
                    .for_each(|l| f(EngineEvent::Line(l)));
                f(EngineEvent::Exit("The engine stopped.".into()));
            });
        }
        *self.running.lock().unwrap() = Some(Running { child, stdin });
        Ok(())
    }

    pub fn send(&self, line: &str) -> Result<(), String> {
        let mut guard = self.running.lock().unwrap();
        let running = guard
            .as_mut()
            .ok_or("The engine is not running. Click Run first.")?;
        writeln!(running.stdin, "{line}")
            .and_then(|_| running.stdin.flush())
            .map_err(|_| "The engine has stopped.".to_string())
    }

    pub fn stop(&self) {
        if let Some(mut r) = self.running.lock().unwrap().take() {
            let _ = writeln!(r.stdin, "quit");
            let _ = r.stdin.flush();
            // Give it a moment to quit by itself, then make sure.
            for _ in 0..20 {
                if let Ok(Some(_)) = r.child.try_wait() {
                    return;
                }
                thread::sleep(std::time::Duration::from_millis(10));
            }
            let _ = r.child.kill();
            let _ = r.child.wait();
        }
    }
}

impl Drop for Engines {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn program_path_comes_from_cargo_toml() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("Cargo.toml"),
            "[package]\nname = \"rando\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        let p = program_path(dir.path()).unwrap();
        assert!(p.ends_with(if cfg!(windows) {
            "target/release/rando.exe"
        } else {
            "target/release/rando"
        }));
    }

    /// A tiny "engine": a shell that echoes lines (Unix only).
    #[cfg(unix)]
    #[test]
    fn talks_to_a_running_program() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("echo.sh");
        std::fs::write(&script, "#!/bin/sh\nwhile read line; do\n  [ \"$line\" = quit ] && exit 0\n  echo \"got $line\"\ndone\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let (tx, rx) = mpsc::channel();
        let engines = Engines::default();
        engines
            .start(&script, dir.path(), move |e| tx.send(e).unwrap())
            .unwrap();
        engines.send("uci").unwrap();
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            EngineEvent::Line("got uci".into())
        );
        engines.stop();
        assert!(matches!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            EngineEvent::Exit(_)
        ));
        assert!(engines.send("go").is_err());
    }
}
