mod ai_cli;
mod browser;
mod config;
mod fs;
mod jobs;
mod mcp;
mod port_forward;
mod pty;
mod remote;
mod secrets;
mod sftp;
mod shell;
mod shell_history;
mod shell_init;
mod tailscale;
mod timeline;
mod vitals;

use jobs::JobsState;
use mcp::McpState;
use port_forward::PortForwardManager;
use pty::PtyState;
use secrets::SecretsState;
use sftp::SftpManager;
use tailscale::TailscaleState;
use tauri::Manager;

/**
 * The macOS menu, deliberately without Undo/Redo.
 *
 * With no menu set, Tauri installs its default, whose Edit submenu owns Cmd+Z and
 * Shift+Cmd+Z as key equivalents. On macOS a menu key equivalent is consumed
 * before the webview sees any keydown, so the editor never received the keystroke
 * — and the native `undo:` the menu sends instead cannot drive Monaco's model, so
 * undo did nothing at all. Leaving those two items out frees the keys for whoever
 * owns the text: Monaco in the editor, WebKit in plain inputs.
 *
 * Cut/copy/paste/select-all stay: those key equivalents do the right thing in a
 * webview, and dropping them would cost the clipboard for no gain.
 */
#[cfg(target_os = "macos")]
fn install_macos_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};

    let app_menu = SubmenuBuilder::new(app, "Husk")
        .about(Some(AboutMetadata::default()))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .fullscreen()
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

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
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().ok();
            app.manage(SftpManager::with_app_data_dir(app_data_dir));

            /* Non-fatal on purpose. Built with `?` inside setup, a menu that
            failed to construct would return Err from setup and stop the app
            launching altogether — bricking the whole app over a menu bar. The
            worst case now is falling back to Tauri's default menu, which means
            Cmd+Z is claimed again: a keyboard annoyance, not a dead launch. */
            #[cfg(target_os = "macos")]
            if let Err(e) = install_macos_menu(app.handle()) {
                eprintln!("husk: could not install the app menu ({e}); using the default");
            }

            Ok(())
        })
        .manage(PtyState::default())
        .manage(ai_cli::AiCliState::default())
        .manage(McpState::default())
        .manage(SecretsState::default())
        .manage(JobsState::default())
        .manage(PortForwardManager::new())
        .manage(TailscaleState::default())
        .manage(timeline::TimelineState::default())
        .invoke_handler(tauri::generate_handler![
            ai_cli::ai_cli_available,
            ai_cli::ai_cli_start,
            ai_cli::ai_cli_stop,
            ai_cli::codex_cli_available,
            ai_cli::codex_cli_models,
            ai_cli::codex_cli_start,
            ai_cli::codex_cli_stop,
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
            config::config_load,
            config::config_save,
            config::config_location,
            config::agents_load,
            config::agent_write,
            config::agent_delete,
            browser::browser_create,
            browser::browser_navigate,
            browser::browser_go,
            browser::browser_set_bounds,
            browser::browser_set_visible,
            browser::browser_close,
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
            sftp::sftp_transfer_cancel,
            sftp::sftp_forget_host_keys,
            sftp::sftp_list_dir,
            sftp::sftp_download,
            sftp::sftp_download_dir,
            sftp::sftp_upload,
            sftp::sftp_upload_dir,
            sftp::sftp_copy,
            sftp::sftp_delete_recursive,
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
            shell::detect_binaries,
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
            timeline::timeline_record,
            timeline::timeline_query,
            timeline::timeline_clear,
            timeline::timeline_workspaces,
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
