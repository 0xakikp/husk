//! Pseudo-terminal backend.
//!
//! Each `pty_spawn` opens a real PTY, spawns the user's shell, and streams its
//! output to the frontend as `pty://data/{id}` events (raw bytes). The frontend
//! writes keystrokes back via `pty_write` and keeps the PTY sized with
//! `pty_resize`. `pty_kill` tears a session down.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, MasterPty, PtyPair, PtySize};
use tauri::{AppHandle, Emitter, State};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<u32, PtySession>>,
}

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let PtyPair { master, slave } = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Spawn the login shell wired with Husk integration (OSC cwd/command marks,
    // autosuggestions, syntax highlighting, fzf). Falls back to a plain shell
    // when the user's shell isn't supported, and to $HOME when `cwd` is unset.
    let cmd = crate::shell_init::build_command(cwd)?;

    let mut child = slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(slave); // not needed once the child holds it

    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    state
        .sessions
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            id,
            PtySession {
                master,
                writer,
                killer,
            },
        );

    // Stream shell output to the frontend until EOF.
    let app_reader = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app_reader.emit(&format!("pty://data/{id}"), buf[..n].to_vec());
                }
            }
        }
        let _ = app_reader.emit::<()>(&format!("pty://exit/{id}"), ());
    });

    // Reap the child so it doesn't linger as a zombie.
    thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(session) = sessions.get_mut(&id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(session) = sessions.get(&id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: u32) {
    let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut session) = sessions.remove(&id) {
        // Explicitly kill the child process before dropping the PTY master.
        // This ensures the shell receives SIGHUP and exits cleanly rather
        // than potentially lingering as a zombie.
        let _ = session.killer.kill();
    }
}

/// Capture PTY output after injecting a command. Used by the `husk cp` bridge
/// to read file contents (base64-encoded) from any terminal session.
#[tauri::command]
pub fn pty_capture(
    state: State<'_, PtyState>,
    id: u32,
    command: String,
    timeout_ms: u64,
) -> Result<String, String> {
    let mut sessions = state.sessions.lock().unwrap_or_else(|e| e.into_inner());
    let session = sessions.get_mut(&id).ok_or("PTY session not found")?;

    // Clear any pending output by reading briefly
    let mut drain = [0u8; 4096];
    let _ = session
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?
        .read(&mut drain);

    // Write the command + newline
    session
        .writer
        .write_all(command.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.write_all(b"\n").map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;

    // Read output until timeout
    let mut reader = session
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;
    let mut output = Vec::new();
    let mut buf = [0u8; 4096];
    let start = Instant::now();
    let timeout = Duration::from_millis(timeout_ms);

    while start.elapsed() < timeout {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => output.extend_from_slice(&buf[..n]),
            Err(_) => break,
        }
        // Small yield to let more data arrive
        thread::sleep(Duration::from_millis(50));
    }

    // Convert bytes to string, best-effort
    let text = String::from_utf8_lossy(&output).to_string();
    Ok(strip_kubeconfig_metadata(&text))
}

/// Bridge captures are a separate reader from xterm. Private prompt metadata
/// must not become copied file contents, captured output or AI context there.
fn strip_kubeconfig_metadata(mut text: &str) -> String {
    let mut public = String::with_capacity(text.len());
    loop {
        let next = ["\u{1b}]779;", "\u{9d}779;"]
            .into_iter()
            .filter_map(|prefix| text.find(prefix).map(|start| (start, prefix.len())))
            .min_by_key(|(start, _)| *start);
        let Some((start, prefix_len)) = next else {
            public.push_str(text);
            return public;
        };
        public.push_str(&text[..start]);
        let private = &text[start + prefix_len..];
        let end = ["\u{7}", "\u{9c}", "\u{1b}\\"]
            .into_iter()
            .filter_map(|marker| private.find(marker).map(|end| (end, marker.len())))
            .min_by_key(|(end, _)| *end);
        // Incomplete metadata is private too; never return its unterminated tail.
        let Some((end, marker_len)) = end else { return public; };
        text = &private[end + marker_len..];
    }
}

#[cfg(test)]
mod tests {
    use super::strip_kubeconfig_metadata;

    #[test]
    fn captures_exclude_private_kubeconfig_osc() {
        assert_eq!(
            strip_kubeconfig_metadata("before\u{1b}]779;husk;kubeconfig;1;value;/private/config\u{1b}\\after\u{1b}]133;B\u{1b}\\"),
            "beforeafter\u{1b}]133;B\u{1b}\\"
        );
        assert_eq!(strip_kubeconfig_metadata("a\u{9d}779;private\u{9c}b\u{1b}]779;private\u{7}c"), "abc");
        assert_eq!(strip_kubeconfig_metadata("visible\u{1b}]779;unfinished/private"), "visible");
    }
}
