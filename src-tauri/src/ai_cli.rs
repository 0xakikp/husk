//! Driving the `claude` CLI as an AI provider.
//!
//! Lets someone on a Claude subscription use Husk's AI without pasting an API
//! key: instead of Husk calling Anthropic, it runs the CLI the user is already
//! logged into and reads what it prints. Husk never sees or stores a credential.
//!
//! Deliberately **not** reading Claude Code's keychain entry to use its token
//! directly. That entry is ACL'd to the app that wrote it, so reading it either
//! prompts or fails and breaks whenever the CLI changes storage — and a
//! subscription pays for use through Anthropic's own products, not as a general
//! API credential for other apps. Asking the CLI to do the work is the honest
//! version of the same idea.
//!
//! Why this is not `shell_bg_spawn`: that pumps stdout *and* stderr into one
//! bounded ring buffer. Any warning the CLI writes to stderr would land in the
//! middle of the NDJSON, and a long answer could push earlier bytes out of the
//! ring. Structured streaming needs stdout on its own, whole, and line by line.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use shared_child::SharedChild;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::shell::validate_program;

#[derive(Default)]
pub struct AiCliState {
    running: Mutex<HashMap<String, Arc<SharedChild>>>,
}

/// Whether the CLI is installed. The provider is hidden unless this is true, so
/// the settings page never offers a login that cannot work.
#[tauri::command]
pub fn ai_cli_available() -> bool {
    validate_program("claude").is_ok()
}

/// Spawn `claude` and stream its stdout to the front end, one line per event.
///
/// Events, all keyed by the caller's `id` so several chats can run at once:
///   `ai-cli://line/{id}`  one line of stdout (NDJSON when --output-format is set)
///   `ai-cli://err/{id}`   stderr, forwarded so failures are reportable
///   `ai-cli://exit/{id}`  exit code, or null if it could not be determined
#[tauri::command]
pub fn ai_cli_start(
    app: AppHandle,
    state: State<AiCliState>,
    id: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    let program = validate_program("claude")
        .map_err(|_| "the `claude` CLI is not on PATH".to_string())?;

    let mut cmd = Command::new(program);
    cmd.args(&args);
    if let Some(dir) = cwd.filter(|d| std::path::Path::new(d).is_dir()) {
        cmd.current_dir(dir);
    }
    // stdin null: the prompt goes in as an argument, and an inherited stdin would
    // let the CLI block forever waiting on input nobody can type.
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let child = SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?;
    let stdout = child.take_stdout().ok_or("no stdout pipe")?;
    let stderr = child.take_stderr().ok_or("no stderr pipe")?;
    let child = Arc::new(child);

    state
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), child.clone());

    // stdout, line by line. read_line rather than a byte buffer, so a JSON object
    // split across two reads is never handed over half-parsed.
    {
        let app = app.clone();
        let id = id.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) if !l.trim().is_empty() => {
                        let _ = app.emit(&format!("ai-cli://line/{id}"), l);
                    }
                    Ok(_) => {}
                    Err(_) => break,
                }
            }
        });
    }

    {
        let app = app.clone();
        let id = id.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    let _ = app.emit(&format!("ai-cli://err/{id}"), line);
                }
            }
        });
    }

    // Reap, report, and drop the handle so a finished chat does not leak.
    {
        let app = app.clone();
        let waiter = child.clone();
        let id_for_exit = id.clone();
        thread::spawn(move || {
            let code = waiter.wait().ok().and_then(|s| s.code());
            let _ = app.emit(&format!("ai-cli://exit/{id_for_exit}"), code);
            if let Some(state) = app.try_state::<AiCliState>() {
                if let Ok(mut running) = state.running.lock() {
                    running.remove(&id_for_exit);
                }
            }
        });
    }

    Ok(())
}

/// Stop a run. Used by the composer's stop button, and on unmount so a killed
/// chat does not keep burning plan usage in the background.
#[tauri::command]
pub fn ai_cli_stop(state: State<AiCliState>, id: String) -> Result<(), String> {
    if let Some(child) = state
        .running
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
    {
        let _ = child.kill();
    }
    Ok(())
}
