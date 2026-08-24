//! Driving signed-in coding CLIs as AI providers.
//!
//! Lets someone with a supported signed-in coding CLI use Husk's AI without
//! pasting an API key: instead of Husk calling a provider API, it runs the CLI
//! already logged into and reads what it prints. Husk never sees or stores a
//! credential.
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

/// Whether Gemini CLI is installed. Sign-in remains owned by Gemini CLI; Husk
/// only detects the executable before offering this subscription backend.
#[tauri::command]
pub fn gemini_cli_available() -> bool {
    cli_available("gemini")
}

/// Whether Kimi Code is installed. Its membership/OAuth login remains private
/// to the Kimi CLI and is never imported into Husk.
#[tauri::command]
pub fn kimi_cli_available() -> bool {
    cli_available("kimi")
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
    cli_start(app, state, id, args, cwd, "claude", "ai-cli", &[])
}

/// Spawn `codex exec --json` and stream its JSONL output to the front end.
#[tauri::command]
pub fn codex_cli_start(
    app: AppHandle,
    state: State<AiCliState>,
    id: String,
    mut args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    /* Feature flags remove Codex's known tool families. A Husk-owned deny-all
       PreToolUse hook is injected last as defence in depth for apply_patch and
       any future local function tool. The frontend never supplies this path. */
    let hook = write_codex_deny_hook(&app)?;
    let hook_command = shell_command_for_path(&hook);
    let hook_config = codex_hook_config(hook_command);
    let prompt = args.pop().ok_or("codex prompt is missing")?;
    args.push("--dangerously-bypass-hook-trust".to_owned());
    args.push("--config".to_owned());
    args.push(hook_config);
    args.push(prompt);
    cli_start(app, state, id, args, cwd, "codex", "codex-cli", &[])
}

/// Spawn Gemini CLI with a per-run, deny-all admin policy. Passing this
/// explicit policy is important: a signed-in CLI may have user-installed
/// extensions or MCP servers, but a Husk planning conversation must never
/// inherit tool access that bypasses the Husk Action Broker.
#[tauri::command]
pub fn gemini_cli_start(
    app: AppHandle,
    state: State<AiCliState>,
    id: String,
    mut args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    let policy = write_husk_cli_profile(&app, "gemini-read-only.toml", GEMINI_READ_ONLY_POLICY)?;
    args.push("--admin-policy".to_owned());
    args.push(policy);
    cli_start(app, state, id, args, cwd, "gemini", "gemini-cli", &[])
}

/// Spawn Kimi Code with a one-run agent whose empty tool allowlist is enforced
/// by Kimi. Kimi's `-p` mode otherwise uses automatic permission handling, so
/// a system-prompt request alone would not be a trustworthy safety boundary.
#[tauri::command]
pub fn kimi_cli_start(
    app: AppHandle,
    state: State<AiCliState>,
    id: String,
    mut args: Vec<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    let agent = write_husk_cli_profile(&app, "kimi-read-only.md", KIMI_READ_ONLY_AGENT)?;
    args.push("--agent-file".to_owned());
    args.push(agent);
    cli_start(
        app,
        state,
        id,
        args,
        cwd,
        "kimi",
        "kimi-cli",
        &[
            // Kimi currently gates explicit per-run main agents behind this
            // flag. The profile below has `tools: []`, so enabling it does not
            // grant any tools to the Husk conversation.
            ("KIMI_CODE_EXPERIMENTAL_FLAG", "1"),
            // A backend request must never make a package-update decision for
            // the user in the middle of a Husk conversation.
            ("KIMI_CODE_NO_AUTO_UPDATE", "1"),
        ],
    )
}

const GEMINI_READ_ONLY_POLICY: &str = r#"# Rewritten by Husk before every Gemini subscription request.
# A global deny removes every built-in, extension, and MCP tool from the model.
[[rule]]
toolName = "*"
decision = "deny"
priority = 999
denyMessage = "Husk owns actions. Return a husk-action proposal instead of running a tool."
"#;

const KIMI_READ_ONLY_AGENT: &str = r#"---
name: husk-action-planner
description: Tool-free planner for a Husk subscription conversation.
tools: []
subagents: []
---
You are the tool-free Kimi planner inside Husk. Answer questions and suggest
safe next steps, but do not claim to edit files, run commands, or use external
tools. When the prompt permits it, return a husk-action proposal; Husk validates
and runs it under its own review policy.
"#;

/// Keep generated policy/profile files inside Husk application data, never in
/// a repository or in a user's CLI configuration. Rewriting before each run
/// prevents stale or manually changed content from weakening the boundary.
fn write_husk_cli_profile(app: &AppHandle, name: &str, contents: &str) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not locate Husk application data: {e}"))?
        .join("cli-profiles");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create CLI profile directory: {e}"))?;
    let path = dir.join(name);
    std::fs::write(&path, contents).map_err(|e| format!("could not prepare CLI profile: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

fn write_codex_deny_hook(app: &AppHandle) -> Result<String, String> {
    #[cfg(windows)]
    const NAME: &str = "deny-codex-tool.cmd";
    #[cfg(windows)]
    const CONTENTS: &str = "@echo off\r\necho {\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Husk owns actions; return a husk-action proposal.\"}}\r\n";
    #[cfg(not(windows))]
    const NAME: &str = "deny-codex-tool.sh";
    #[cfg(not(windows))]
    const CONTENTS: &str = "#!/bin/sh\nprintf '%s\\n' '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Husk owns actions; return a husk-action proposal.\"}}'\n";

    let path = write_husk_cli_profile(app, NAME, CONTENTS)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("could not secure Codex tool hook: {e}"))?;
    }
    Ok(path)
}

fn codex_hook_config(command: String) -> String {
    format!(
        "hooks.PreToolUse=[{{ matcher = \".*\", hooks = [{{ type = \"command\", command = {}, timeout = 5 }}] }}]",
        toml::Value::String(command)
    )
}

#[cfg(windows)]
fn shell_command_for_path(path: &str) -> String {
    format!("cmd /C \\\"{}\\\"", path.replace('"', "\\\""))
}

#[cfg(not(windows))]
fn shell_command_for_path(path: &str) -> String {
    format!("'{}'", path.replace('\'', "'\\''"))
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
    environment: &[(&str, &str)],
) -> Result<(), String> {
    let program = validate_program(program_name)
        .map_err(|_| format!("the `{program_name}` CLI is not on PATH"))?;

    let mut cmd = Command::new(program);
    cmd.args(&args);
    for &(key, value) in environment {
        cmd.env(key, value);
    }
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

/// Stop a Gemini subscription run.
#[tauri::command]
pub fn gemini_cli_stop(state: State<AiCliState>, id: String) -> Result<(), String> {
    cli_stop(state, id)
}

/// Stop a Kimi subscription run.
#[tauri::command]
pub fn kimi_cli_stop(state: State<AiCliState>, id: String) -> Result<(), String> {
    cli_stop(state, id)
}

fn cli_stop(state: State<AiCliState>, id: String) -> Result<(), String> {
    if let Some(child) = state.running.lock().map_err(|e| e.to_string())?.remove(&id) {
        let _ = child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::codex_hook_config;

    #[test]
    fn codex_deny_hook_is_valid_inline_toml() {
        let config = codex_hook_config("'/tmp/Husk profiles/deny-tool.sh'".to_owned());
        let parsed: toml::Value = toml::from_str(&config).expect("hook config should parse");
        let hooks = parsed
            .get("hooks")
            .and_then(|value| value.get("PreToolUse"))
            .and_then(toml::Value::as_array)
            .expect("PreToolUse array");
        assert_eq!(hooks.len(), 1);
    }
}
