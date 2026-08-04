//! Driving signed-in coding CLIs as AI providers.
//!
//! Lets someone with Claude Code or Codex use Husk's AI without pasting an API
//! key: instead of Husk calling a provider API, it runs the CLI already logged
//! into and reads what it prints. Husk never sees or stores a credential.
//!
//! Deliberately **not** reading either CLI's auth storage to use a token
//! directly. That storage belongs to the app that wrote it and can change at
//! any time; a plan entitlement is not a general API credential for Husk.
//! Asking the CLI to do the work is the honest version of this integration.
//!
//! Why this is not `shell_bg_spawn`: that pumps stdout *and* stderr into one
//! bounded ring buffer. Any warning the CLI writes to stderr would land in the
//! middle of JSONL, and a long answer could push earlier bytes out of the ring.
//! Structured streaming needs stdout on its own, whole, and line by line.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use shared_child::SharedChild;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::shell::validate_program;

#[derive(Default)]
pub struct AiCliState {
    running: Mutex<HashMap<String, Arc<SharedChild>>>,
}

/// Whether Claude Code is installed. The provider is hidden unless this is
/// true, so settings never offers a login that cannot work.
#[tauri::command]
pub fn ai_cli_available() -> bool {
    cli_available("claude")
}

/// Whether Codex is installed. Kept separate from the Claude command because
/// the frontend should only ever choose between these two fixed programs.
#[tauri::command]
pub fn codex_cli_available() -> bool {
    cli_available("codex")
}

#[derive(Deserialize)]
struct CodexModelsCache {
    models: Vec<CodexCachedModel>,
}

#[derive(Deserialize)]
struct CodexCachedModel {
    slug: String,
    display_name: String,
    description: String,
    visibility: Option<String>,
}

#[derive(Serialize)]
pub struct CodexCliModel {
    id: String,
    label: String,
    description: String,
}

/// Return the models the signed-in Codex CLI has cached for this user.
///
/// The cache is produced by Codex itself and reflects the account rather than a
/// universal list. Returning an empty list is intentional when Codex has not
/// yet fetched it; Husk still offers the CLI's own default model in that case.
#[tauri::command]
pub fn codex_cli_models() -> Vec<CodexCliModel> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let cache = home.join(".codex").join("models_cache.json");
    let Ok(text) = std::fs::read_to_string(cache) else {
        return Vec::new();
    };
    let Ok(cache) = serde_json::from_str::<CodexModelsCache>(&text) else {
        return Vec::new();
    };

    cache
        .models
        .into_iter()
        .filter(|model| model.visibility.as_deref() == Some("list"))
        .map(|model| CodexCliModel {
            id: model.slug,
            label: model.display_name,
            description: model.description,
        })
        .collect()
}

fn cli_available(program: &str) -> bool {
    validate_program(program).is_ok()
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
    cli_start(app, state, id, args, cwd, "claude", "ai-cli")
}

/// Spawn `codex exec --json` and stream its JSONL output to the front end.
#[tauri::command]
pub fn codex_cli_start(
    app: AppHandle,
    state: State<AiCliState>,
    id: String,
    args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    cli_start(app, state, id, args, cwd, "codex", "codex-cli")
}

/// Shared process bridge for fixed, trusted CLIs. `program` and
/// `event_prefix` are constants chosen above, never frontend input.
fn cli_start(
    app: AppHandle,
    state: State<AiCliState>,
    id: String,
    args: Vec<String>,
    cwd: Option<String>,
    program_name: &'static str,
    event_prefix: &'static str,
) -> Result<(), String> {
    let program = validate_program(program_name)
        .map_err(|_| format!("the `{program_name}` CLI is not on PATH"))?;

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
                        let _ = app.emit(&format!("{event_prefix}://line/{id}"), l);
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
                    let _ = app.emit(&format!("{event_prefix}://err/{id}"), line);
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
            let _ = app.emit(&format!("{event_prefix}://exit/{id_for_exit}"), code);
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
    cli_stop(state, id)
}

/// Stop a Codex subscription run.
#[tauri::command]
pub fn codex_cli_stop(state: State<AiCliState>, id: String) -> Result<(), String> {
    cli_stop(state, id)
}

fn cli_stop(state: State<AiCliState>, id: String) -> Result<(), String> {
    if let Some(child) = state.running.lock().map_err(|e| e.to_string())?.remove(&id) {
        let _ = child.kill();
    }
    Ok(())
}
