mod fs;
mod jobs;
mod mcp;
mod pty;
mod remote;
mod secrets;
mod sftp;
mod shell;
mod shell_history;
mod shell_init;
mod tailscale;
mod vitals;
mod port_forward;

use jobs::JobsState;
use mcp::McpState;
use pty::PtyState;
use secrets::SecretsState;
use sftp::SftpManager;
use port_forward::PortForwardManager;
use tailscale::TailscaleState;

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
        .plugin(tauri_plugin_updater::Builder::default().build())
        .manage(PtyState::default())
        .manage(McpState::default())
        .manage(SecretsState::default())
        .manage(JobsState::default())
        .manage(SftpManager::default())
        .manage(PortForwardManager::new())
        .manage(TailscaleState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_capture,
            fs::read_dir,
            fs::read_file,
            fs::read_file_base64,
            fs::write_file,
            fs::write_binary_file,
            fs::delete_file,
            fs::home_dir,
            fs::create_file,
            fs::create_dir,
            fs::rename_path,
            fs::delete_path,
            fs::debug_log,
            remote::ssh_read_dir,
            remote::ssh_read_file,
            remote::ssh_write_file,
            remote::ssh_create_file,
            remote::ssh_create_dir,
            remote::ssh_rename_path,
            remote::ssh_delete_path,
            remote::ssh_home_dir,
            remote::ssh_pwd,
            sftp::sftp_connect,
            sftp::sftp_disconnect,
            sftp::sftp_list_dir,
            sftp::sftp_download,
            sftp::sftp_upload,
            sftp::sftp_mkdir,
            sftp::sftp_rename,
            sftp::sftp_delete,
            sftp::sftp_rmdir,
            sftp::sftp_stat,
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
            shell_history::pty_shell_history,
            vitals::system_vitals,
            port_forward::port_forward_start,
            port_forward::port_forward_stop,
            port_forward::port_forward_list,
            tailscale::tailscale_list_devices,
            tailscale::tailscale_test_connection,
            tailscale::tailscale_set_prefs,
            tailscale::tailscale_get_prefs,
            tailscale::tailscale_generate_ssh_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
