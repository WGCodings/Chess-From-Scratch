//! Terminals: the user's shell in a pseudo-terminal, shown in the editor.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

struct Term {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals {
    next: AtomicU32,
    open: Mutex<HashMap<u32, Term>>,
}

/// The user's shell: PowerShell on Windows, $SHELL elsewhere.
fn shell() -> CommandBuilder {
    if cfg!(windows) {
        CommandBuilder::new("powershell.exe")
    } else {
        CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()))
    }
}

impl Terminals {
    pub fn open(
        &self,
        dir: &Path,
        cols: u16,
        rows: u16,
        on_data: impl Fn(String) + Send + 'static,
    ) -> Result<u32, String> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let mut cmd = shell();
        cmd.cwd(dir);
        cmd.env("TERM", "xterm-256color");
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            // A UTF-8 character may be split between two reads: keep the unfinished bytes.
            let mut pending: Vec<u8> = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        let valid = match std::str::from_utf8(&pending) {
                            Ok(_) => pending.len(),
                            Err(e) => e.valid_up_to(),
                        };
                        if valid > 0 {
                            on_data(String::from_utf8_lossy(&pending[..valid]).into_owned());
                            pending.drain(..valid);
                        }
                        if pending.len() > 8 {
                            // Not UTF-8 after all: show it as it is.
                            on_data(String::from_utf8_lossy(&pending).into_owned());
                            pending.clear();
                        }
                    }
                }
            }
            on_data("\r\n[the terminal closed]\r\n".into());
        });
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        self.open.lock().unwrap().insert(
            id,
            Term {
                master: pair.master,
                writer,
                child,
            },
        );
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let mut open = self.open.lock().unwrap();
        let t = open.get_mut(&id).ok_or("This terminal is closed.")?;
        t.writer
            .write_all(data.as_bytes())
            .and_then(|_| t.writer.flush())
            .map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let open = self.open.lock().unwrap();
        let t = open.get(&id).ok_or("This terminal is closed.")?;
        t.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn close(&self, id: u32) {
        if let Some(mut t) = self.open.lock().unwrap().remove(&id) {
            let _ = t.child.kill();
        }
    }
}

impl Drop for Terminals {
    fn drop(&mut self) {
        for (_, mut t) in self.open.lock().unwrap().drain() {
            let _ = t.child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    #[cfg(unix)]
    #[test]
    fn runs_commands_in_the_project_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("marker.txt"), "").unwrap();
        let (tx, rx) = mpsc::channel::<String>();
        let terms = Terminals::default();
        let id = terms
            .open(dir.path(), 80, 24, move |s| {
                let _ = tx.send(s);
            })
            .unwrap();
        terms.write(id, "ls\n").unwrap();
        let mut seen = String::new();
        let end = Instant::now() + Duration::from_secs(5);
        while Instant::now() < end && !seen.contains("marker.txt") {
            if let Ok(s) = rx.recv_timeout(Duration::from_millis(200)) {
                seen.push_str(&s);
            }
        }
        terms.close(id);
        assert!(seen.contains("marker.txt"), "terminal output: {seen}");
    }
}
