mod fs;
mod jobs;
mod mcp;
mod pty;
mod secrets;
mod shell;
mod shell_history;
mod shell_init;

use jobs::JobsState;
use mcp::McpState;
use pty::PtyState;
use secrets::SecretsState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(true) = event {
                let _ = window.show();
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(PtyState::default())
        .manage(McpState::default())
        .manage(SecretsState::default())
        .manage(JobsState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            fs::read_dir,
            fs::read_file,
            fs::write_file,
            fs::home_dir,
            fs::create_file,
            fs::create_dir,
            fs::rename_path,
            fs::delete_path,
            mcp::mcp_spawn,
            mcp::mcp_send,
            mcp::mcp_recv,
            mcp::mcp_kill,
            shell::shell_run_command,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_get_all,
            jobs::shell_bg_spawn,
            jobs::shell_bg_logs,
            jobs::shell_bg_kill,
            jobs::shell_bg_remove,
            jobs::shell_bg_list,
            shell_history::pty_shell_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
