mod input;

use input::RemoteInputEvent;
use serde::Serialize;

#[derive(Serialize)]
struct ScreenInfo {
    width: u32,
    height: u32,
}

#[tauri::command]
fn get_screen_info() -> Result<ScreenInfo, String> {
    let (width, height) = input::get_screen_info()?;
    Ok(ScreenInfo { width, height })
}

#[tauri::command]
fn inject_remote_event(event: RemoteInputEvent) -> Result<(), String> {
    input::inject_event(event)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_screen_info,
            inject_remote_event
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
