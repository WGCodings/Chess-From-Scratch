//! Debug builds only: `CFS_SELFTEST=<script.js>` runs a script in the editor
//! window that drives the app and reports through `selftest_done`.

use tauri::{Manager, Runtime};

pub fn install<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    let Some(path) = std::env::var_os("CFS_SELFTEST") else {
        return builder;
    };
    let script = std::fs::read_to_string(&path).expect("CFS_SELFTEST script");
    builder.setup(move |app| {
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(4));
            if let Some(w) = handle.get_webview_window("main") {
                w.eval(&script).expect("eval selftest");
            }
        });
        Ok(())
    })
}

#[tauri::command]
pub fn selftest_done(app: tauri::AppHandle, ok: bool, report: String) {
    println!(
        "SELFTEST {}\n{report}",
        if ok { "PASSED" } else { "FAILED" }
    );
    app.exit(if ok { 0 } else { 1 });
}
