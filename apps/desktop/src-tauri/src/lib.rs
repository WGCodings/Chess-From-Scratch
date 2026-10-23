//! The desktop side of Chess From Scratch. The editor is the same web app as
//! the website; these commands give it what a browser can't have: writing the
//! engine's project to disk, building it with cargo, running it, and a
//! terminal. The editor calls them through `apps/web/src/platform.ts`.

mod engine;
mod project;
#[cfg(debug_assertions)]
mod selftest;
mod terminal;

use std::path::PathBuf;

use tauri::ipc::Channel;
use tauri::{Manager, State};

use engine::{EngineEvent, Engines};
use project::ProjectFile;
use terminal::Terminals;

/// Where an engine's project lives unless the user picked a folder:
/// `<app data>/engines/<crate name>`.
#[tauri::command]
fn default_project_dir(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let base = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let dir = base.join("engines").join(project::safe_name(&name));
    Ok(dir.to_string_lossy().into_owned())
}

/// Writes the generated files into `dir` (keeping `target/`), removing source files the engine no longer has.
#[tauri::command]
fn write_project(dir: String, files: Vec<ProjectFile>) -> Result<(), String> {
    project::write(&PathBuf::from(dir), &files).map_err(|e| e.to_string())
}

/// Reads a file the user picked (a saved workbench).
#[tauri::command]
fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Could not read {path}: {e}"))
}

/// Writes a file the user picked, through a temporary file so a crash never leaves half a file.
#[tauri::command]
fn write_file(path: String, data: Vec<u8>) -> Result<(), String> {
    project::write_atomic(std::path::Path::new(&path), &data)
        .map_err(|e| format!("Could not save {path}: {e}"))
}

/// `cargo --version`, or an error when Rust is not installed.
#[tauri::command]
async fn rust_version() -> Result<String, String> {
    engine::cargo_version()
}

/// Builds the engine in `dir` with `cargo build --release`, streaming every
/// output line; returns the path of the program.
#[tauri::command]
async fn build_engine(dir: String, on_line: Channel<String>) -> Result<String, String> {
    engine::build(&PathBuf::from(dir), move |line| {
        let _ = on_line.send(line);
    })
}

/// Starts the engine program; its output arrives on `on_event`.
#[tauri::command]
fn start_engine(
    engines: State<'_, Engines>,
    program: String,
    dir: String,
    on_event: Channel<EngineEvent>,
) -> Result<(), String> {
    engines.start(&PathBuf::from(program), &PathBuf::from(dir), move |event| {
        let _ = on_event.send(event);
    })
}

/// Sends one line (a UCI command) to the running engine.
#[tauri::command]
fn send_engine(engines: State<'_, Engines>, line: String) -> Result<(), String> {
    engines.send(&line)
}

#[tauri::command]
fn stop_engine(engines: State<'_, Engines>) -> Result<(), String> {
    engines.stop();
    Ok(())
}

/// Opens a terminal (the user's shell) in `dir`; its output arrives on `on_data`.
#[tauri::command]
fn open_terminal(
    terminals: State<'_, Terminals>,
    dir: String,
    cols: u16,
    rows: u16,
    on_data: Channel<String>,
) -> Result<u32, String> {
    terminals.open(&PathBuf::from(dir), cols, rows, move |data| {
        let _ = on_data.send(data);
    })
}

#[tauri::command]
fn write_terminal(terminals: State<'_, Terminals>, id: u32, data: String) -> Result<(), String> {
    terminals.write(id, &data)
}

#[tauri::command]
fn resize_terminal(
    terminals: State<'_, Terminals>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    terminals.resize(id, cols, rows)
}

#[tauri::command]
fn close_terminal(terminals: State<'_, Terminals>, id: u32) -> Result<(), String> {
    terminals.close(id);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(debug_assertions)]
    let builder = selftest::install(builder);
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Engines::default())
        .manage(Terminals::default())
        .invoke_handler(tauri::generate_handler![
            default_project_dir,
            write_project,
            read_file,
            write_file,
            rust_version,
            build_engine,
            start_engine,
            send_engine,
            stop_engine,
            open_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            #[cfg(debug_assertions)]
            selftest::selftest_done
        ])
        .run(tauri::generate_context!())
        .expect("error while running Chess From Scratch");
}
