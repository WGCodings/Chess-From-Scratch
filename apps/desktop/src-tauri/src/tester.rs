//! Engine tests: fastchess (found on the computer, or downloaded once into
//! the app's tools folder), opening books (downloaded once), `bench` runs and
//! the fastchess process itself. The command line and reading the results
//! are the editor's job (`packages/codegen/src/sprt.ts`).

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use crate::engine::EngineEvent;

pub const FASTCHESS_EXE: &str = if cfg!(windows) {
    "fastchess.exe"
} else {
    "fastchess"
};

/// The fastchess release archive for this computer.
pub fn fastchess_asset() -> Result<String, String> {
    let platform = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "mac",
        "linux" => "linux",
        other => {
            return Err(format!(
            "fastchess has no download for {other}; install it yourself and put it on your PATH"
        ))
        }
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86-64",
        "aarch64" => "arm64",
        other => {
            return Err(format!(
                "fastchess has no download for {other} processors; install it yourself"
            ))
        }
    };
    let ext = if platform == "windows" { "zip" } else { "tar" };
    Ok(format!("fastchess-{platform}-{arch}.{ext}"))
}

/// fastchess in the tools folder, or on PATH.
pub fn find_fastchess(tools: &Path) -> Option<PathBuf> {
    let local = tools.join("fastchess").join(FASTCHESS_EXE);
    if local.is_file() {
        return Some(local);
    }
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|d| d.join(FASTCHESS_EXE))
        .find(|p| p.is_file())
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .tls_config(
            ureq::tls::TlsConfig::builder()
                .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                .build(),
        )
        .timeout_global(Some(Duration::from_secs(600)))
        .build()
        .into()
}

/// Downloads `url` into memory, reporting progress now and then.
pub fn download(url: &str, on_line: &dyn Fn(String)) -> Result<Vec<u8>, String> {
    on_line(format!("Downloading {url}"));
    let mut response = agent()
        .get(url)
        .call()
        .map_err(|e| format!("Could not download {url}: {e}"))?;
    let total = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    let mut reader = response
        .body_mut()
        .with_config()
        .limit(200 * 1024 * 1024)
        .reader();
    let mut data = Vec::new();
    let mut buf = [0u8; 64 * 1024];
    let mut last = Instant::now();
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Download of {url} failed: {e}"))?;
        if n == 0 {
            break;
        }
        data.extend_from_slice(&buf[..n]);
        if last.elapsed() > Duration::from_millis(700) {
            last = Instant::now();
            let mb = data.len() as f64 / 1e6;
            on_line(match total {
                Some(t) => format!("  {mb:.1} of {:.1} MB", t as f64 / 1e6),
                None => format!("  {mb:.1} MB"),
            });
        }
    }
    Ok(data)
}

/// The bytes of the first file in a zip or tar archive whose name ends with `name`.
pub fn extract(archive: &[u8], is_zip: bool, name: &str) -> Result<Vec<u8>, String> {
    let matches = |p: &str| p.rsplit(['/', '\\']).next() == Some(name);
    if is_zip {
        let mut zip =
            zip::ZipArchive::new(std::io::Cursor::new(archive)).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
            if f.is_file() && f.name().map(|n| matches(&n)).unwrap_or(false) {
                let mut out = Vec::new();
                f.read_to_end(&mut out).map_err(|e| e.to_string())?;
                return Ok(out);
            }
        }
    } else {
        let mut tar = tar::Archive::new(std::io::Cursor::new(archive));
        for entry in tar.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let path = entry
                .path()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned();
            if entry.header().entry_type().is_file() && matches(&path) {
                let mut out = Vec::new();
                entry.read_to_end(&mut out).map_err(|e| e.to_string())?;
                return Ok(out);
            }
        }
    }
    Err(format!("{name} was not found in the download"))
}

fn write_executable(path: &Path, data: &[u8]) -> Result<(), String> {
    crate::project::write_atomic(path, data).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Downloads fastchess into `tools/fastchess/` and returns its path.
pub fn install_fastchess(tools: &Path, on_line: &dyn Fn(String)) -> Result<PathBuf, String> {
    let asset = fastchess_asset()?;
    let url = format!("https://github.com/Disservin/fastchess/releases/latest/download/{asset}");
    let archive = download(&url, on_line)?;
    let exe = extract(&archive, asset.ends_with(".zip"), FASTCHESS_EXE)?;
    let path = tools.join("fastchess").join(FASTCHESS_EXE);
    write_executable(&path, &exe)?;
    on_line(format!("fastchess is ready: {}", path.display()));
    Ok(path)
}

/// An opening book in `tools/books/`, downloaded (a zip holding `file`) the first time.
pub fn book(
    tools: &Path,
    file: &str,
    url: &str,
    on_line: &dyn Fn(String),
) -> Result<PathBuf, String> {
    if file.contains(['/', '\\']) || file.starts_with('.') {
        return Err("bad book name".into());
    }
    let path = tools.join("books").join(file);
    if path.is_file() {
        return Ok(path);
    }
    let archive = download(url, on_line)?;
    let data = if url.ends_with(".zip") {
        extract(&archive, true, file)?
    } else {
        archive
    };
    crate::project::write_atomic(&path, &data).map_err(|e| e.to_string())?;
    on_line(format!("The opening book is ready: {}", path.display()));
    Ok(path)
}

/// Runs `<program> bench` and returns what it printed.
pub fn bench(program: &Path) -> Result<String, String> {
    let mut child = crate::engine::command(program)
        .arg("bench")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start {}: {e}", program.display()))?;
    let mut out = String::new();
    child
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut out)
        .map_err(|e| e.to_string())?;
    let mut err = String::new();
    let _ = child.stderr.take().unwrap().read_to_string(&mut err);
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!(
            "bench failed ({status}): {}{}",
            out.trim(),
            err.trim()
        ));
    }
    Ok(format!("{out}{err}"))
}

/// The test that is running (one at a time).
#[derive(Default)]
pub struct Tests {
    running: Mutex<Option<Child>>,
}

impl Tests {
    pub fn start(
        &self,
        program: &Path,
        args: &[String],
        dir: &Path,
        on_event: impl Fn(EngineEvent) + Send + Sync + 'static,
    ) -> Result<(), String> {
        if self.is_running() {
            return Err("A test is already running. Stop it first.".into());
        }
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let mut child = crate::engine::command(program)
            .args(args)
            .current_dir(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not start fastchess: {e}"))?;
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
                f(EngineEvent::Exit("fastchess finished.".into()));
            });
        }
        *self.running.lock().unwrap() = Some(child);
        Ok(())
    }

    pub fn is_running(&self) -> bool {
        let mut guard = self.running.lock().unwrap();
        match guard.as_mut() {
            Some(c) => match c.try_wait() {
                Ok(None) => true,
                _ => {
                    *guard = None;
                    false
                }
            },
            None => false,
        }
    }

    /// Stops fastchess: politely first (so it stops its engines), then for sure.
    pub fn stop(&self) {
        let Some(mut child) = self.running.lock().unwrap().take() else {
            return;
        };
        #[cfg(unix)]
        unsafe {
            libc::kill(child.id() as i32, libc::SIGINT);
        }
        let end = Instant::now() + Duration::from_secs(5);
        while Instant::now() < end {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl Drop for Tests {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Follows a growing log file (fastchess's engine log) and passes on the
/// lines that show the games: positions sent to the engines, the clocks and
/// their moves. Watching costs some speed, so it only runs when asked.
#[derive(Default)]
pub struct LogWatch {
    stop: Mutex<Option<std::sync::Arc<std::sync::atomic::AtomicBool>>>,
}

/// The lines of a fastchess engine log that matter for showing games.
pub fn is_game_line(line: &str) -> bool {
    line.contains("<--- position ") || line.contains("<--- go ") || line.contains("---> bestmove ")
}

impl LogWatch {
    pub fn start(&self, path: PathBuf, on_lines: impl Fn(Vec<String>) + Send + 'static) {
        self.stop();
        let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        *self.stop.lock().unwrap() = Some(flag.clone());
        thread::spawn(move || {
            use std::io::{Seek, SeekFrom};
            use std::sync::atomic::Ordering;
            let mut offset = 0u64;
            let mut partial = String::new();
            while !flag.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(150));
                let Ok(mut f) = std::fs::File::open(&path) else {
                    continue;
                };
                let len = f.metadata().map(|m| m.len()).unwrap_or(0);
                if len < offset {
                    // The file was started again.
                    offset = 0;
                    partial.clear();
                }
                if len == offset || f.seek(SeekFrom::Start(offset)).is_err() {
                    continue;
                }
                let mut buf = Vec::new();
                if f.take(4 * 1024 * 1024).read_to_end(&mut buf).is_err() {
                    continue;
                }
                offset += buf.len() as u64;
                partial.push_str(&String::from_utf8_lossy(&buf));
                let mut lines = Vec::new();
                while let Some(i) = partial.find('\n') {
                    let line: String = partial.drain(..=i).collect();
                    if is_game_line(&line) {
                        lines.push(line.trim_end().to_string());
                    }
                }
                if !lines.is_empty() {
                    on_lines(lines);
                }
            }
        });
    }

    pub fn stop(&self) {
        if let Some(f) = self.stop.lock().unwrap().take() {
            f.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_a_growing_log() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("live.log");
        let (tx, rx) = std::sync::mpsc::channel();
        let watch = LogWatch::default();
        watch.start(path.clone(), move |l| tx.send(l).unwrap());
        std::fs::write(&path, "[Engine] [t] <  1>  a <--- position startpos moves e2e4\n[Engine] [t] <  1>  a ---> info depth 1\n").unwrap();
        let got = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(got.len(), 1);
        assert!(got[0].ends_with("moves e2e4"));
        watch.stop();
    }

    #[test]
    fn knows_the_download_for_this_computer() {
        let a = fastchess_asset().unwrap();
        assert!(
            a.starts_with("fastchess-") && (a.ends_with(".zip") || a.ends_with(".tar")),
            "{a}"
        );
    }

    #[test]
    fn extracts_from_zip_and_tar() {
        let mut zip_bytes = Vec::new();
        {
            let mut w = zip::ZipWriter::new(std::io::Cursor::new(&mut zip_bytes));
            w.start_file("dir/book.epd", zip::write::SimpleFileOptions::default())
                .unwrap();
            std::io::Write::write_all(&mut w, b"fen").unwrap();
            w.finish().unwrap();
        }
        assert_eq!(extract(&zip_bytes, true, "book.epd").unwrap(), b"fen");
        let mut tar_bytes = Vec::new();
        {
            let mut b = tar::Builder::new(&mut tar_bytes);
            let mut h = tar::Header::new_gnu();
            h.set_size(3);
            h.set_mode(0o755);
            h.set_cksum();
            b.append_data(&mut h, "fastchess-linux-x86-64/fastchess", &b"bin"[..])
                .unwrap();
            b.finish().unwrap();
        }
        assert_eq!(extract(&tar_bytes, false, "fastchess").unwrap(), b"bin");
        assert!(extract(&tar_bytes, false, "nope").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn runs_and_stops_a_test_process() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("fake.sh");
        std::fs::write(
            &script,
            "#!/bin/sh\necho \"Games: 2, Wins: 1, Losses: 0, Draws: 1\"\nsleep 30\n",
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let tests = Tests::default();
        tests
            .start(&script, &[], dir.path(), move |e| tx.send(e).unwrap())
            .unwrap();
        assert!(
            matches!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), EngineEvent::Line(l) if l.starts_with("Games: 2"))
        );
        assert!(tests.is_running());
        assert!(tests.start(&script, &[], dir.path(), |_| {}).is_err());
        tests.stop();
        assert!(!tests.is_running());
    }
}
