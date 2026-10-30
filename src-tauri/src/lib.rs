use tauri_plugin_fs::FsExt;

// Opens the fs plugin to a folder the user picked in Settings (Ashita scripts, FFXI USER), for this run only.
#[tauri::command]
fn allow_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).is_dir() {
        return Err(format!("Not a folder: {path}"));
    }
    app.fs_scope().allow_directory(&path, true).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build()) // remembers size, position and monitor
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![allow_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
