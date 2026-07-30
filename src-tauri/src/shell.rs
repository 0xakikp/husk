//! One-shot shell command runner (distinct from the interactive PTY).
//! Used by the docker / kubernetes / terraform clients to run a CLI and
//! capture its output, with a timeout and output cap.
//!
//! Security: commands are executed directly via std::process::Command with an
//! explicit program and argument array. No shell is invoked, so shell
//! metacharacters in arguments are treated as literal data.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde::Serialize;

const MAX_OUT: usize = 256 * 1024;

/// Shell interpreters that must never be invoked directly. These are excluded
/// to prevent callers from bypassing the no-shell rule by passing
/// `sh -c '...'` or similar.
const SHELL_NAMES: &[&str] = &[
    "sh",
    "bash",
    "zsh",
    "cmd",
    "cmd.exe",
    "powershell",
    "powershell.exe",
    "pwsh",
    "pwsh.exe",
];

/// Characters that are not allowed in a program path. None of these can appear
/// in a safe binary name or absolute path.
fn program_has_metachar(program: &str) -> bool {
    program.chars().any(|c| {
        matches!(
            c,
            ';' | '|'
                | '&'
                | '$'
                | '('
                | ')'
                | '`'
                | '<'
                | '>'
                | '*'
                | '?'
                | '['
                | ']'
                | '{'
                | '}'
                | '~'
                | ' '
                | '\n'
                | '\t'
                | '"'
                | '\''
        )
    })
}

/// Resolve a binary name or absolute path to an executable path.
/// Uses the current process PATH first, then falls back to the user's
/// login shell so PATH modifications from .zshrc/.bash_profile are honored.
/// This lets GUI-launched apps find Homebrew, OrbStack, and other tools.
fn resolve_binary_path(program: &str) -> Result<PathBuf, String> {
    if program.is_empty() {
        return Err("program is empty".to_string());
    }
    if program_has_metachar(program) {
        return Err(format!("program contains shell metacharacters: {program}"));
    }

    let path = Path::new(program);
    let base = path.file_stem().and_then(|s| s.to_str()).unwrap_or(program);
    let base_lower = base.to_lowercase();
    if SHELL_NAMES.iter().any(|s| *s == base_lower) {
        return Err(format!(
            "'{program}' is a shell interpreter and is not allowed"
        ));
    }

    // Absolute path: use as-is if it exists.
    if path.is_absolute() {
        if !path.exists() {
            return Err(format!("program does not exist: {program}"));
        }
        return Ok(path.to_path_buf());
    }

    // Search current process PATH.
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(program);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // Fall back to login shell resolution (macOS GUI apps inherit a minimal PATH).
    let script = format!("command -v {}", shell_quote(program));
    let output = Command::new("sh")
        .arg("-lc")
        .arg(&script)
        .output()
        .map_err(|e| format!("failed to resolve program via login shell: {e}"))?;

    if output.status.success() {
        let line = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !line.is_empty() {
            let candidate = PathBuf::from(line);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(format!("program not found on PATH: {program}"))
}

/// Validate that `program` is a real executable and not a shell interpreter.
/// Returns the resolved absolute path so the caller can use it directly.
pub fn validate_program(program: &str) -> Result<PathBuf, String> {
    resolve_binary_path(program)
}

/// Quote a single token for safe interpolation into a POSIX shell command.
/// Used only by the trusted detection helper, not for arbitrary user input.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[derive(Serialize)]
pub struct ShellOutput {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
    truncated: bool,
}

#[tauri::command]
pub fn shell_run_command(
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<ShellOutput, String> {
    let resolved_program = validate_program(&program)?;
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(20));
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let mut c = Command::new(&resolved_program);
        c.args(&args);
        if let Some(dir) = cwd {
            c.current_dir(dir);
        }
        let output = c.output();
        let _ = tx.send(output);
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => {
            let truncated = output.stdout.len() > MAX_OUT || output.stderr.len() > MAX_OUT;
            let so = &output.stdout[..output.stdout.len().min(MAX_OUT)];
            let se = &output.stderr[..output.stderr.len().min(MAX_OUT)];
            Ok(ShellOutput {
                stdout: String::from_utf8_lossy(so).to_string(),
                stderr: String::from_utf8_lossy(se).to_string(),
                exit_code: output.status.code(),
                timed_out: false,
                truncated,
            })
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Ok(ShellOutput {
            stdout: String::new(),
            stderr: "command timed out".to_string(),
            exit_code: None,
            timed_out: true,
            truncated: false,
        }),
    }
}

/// Detect which of the requested binaries are installed.
/// Runs `command -v` through the user's login shell so Homebrew and other
/// PATH modifications are applied, matching the behaviour of an interactive
/// shell. Each name is validated and quoted before reaching the shell.
#[tauri::command]
pub fn detect_binaries(bins: Vec<String>) -> Result<Vec<String>, String> {
    let mut found = Vec::new();

    for bin in bins {
        if bin.is_empty() {
            continue;
        }
        if program_has_metachar(&bin) {
            continue;
        }
        // Reject shell interpreters being asked for as a "binary".
        let base = Path::new(&bin)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&bin)
            .to_lowercase();
        if SHELL_NAMES.iter().any(|s| *s == base) {
            continue;
        }

        let script = format!("command -v {}", shell_quote(&bin));
        let output = Command::new("sh")
            .arg("-lc")
            .arg(&script)
            .output()
            .map_err(|e| e.to_string())?;

        if output.status.success() {
            let line = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !line.is_empty() && PathBuf::from(&line).exists() {
                found.push(bin);
            }
        }
    }

    Ok(found)
}
