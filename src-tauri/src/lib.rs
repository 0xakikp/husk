mod fs;
mod mcp;
mod pty;
mod shell;
mod shell_init;

use mcp::McpState;
use pty::PtyState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(PtyState::default())
        .manage(McpState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            fs::read_dir,
            fs::read_file,
            fs::write_file,
            fs::home_dir,
            mcp::mcp_spawn,
            mcp::mcp_send,
            mcp::mcp_recv,
            mcp::mcp_kill,
            shell::shell_run_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
