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

#[cfg(unix)]
use std::ffi::CStr;

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

/// Return the shell selected for this account, even when Husk was launched by
/// Finder/Dock and therefore did not inherit a terminal's `$SHELL` or `$PATH`.
/// On Unix the account record is the durable source of truth; `$SHELL` wins
/// when it is available because it reflects the user's active preference.
fn user_login_shell() -> PathBuf {
    if let Some(shell) = std::env::var_os("SHELL") {
        let path = PathBuf::from(shell);
        if path.is_file() {
            return path;
        }
    }

    #[cfg(unix)]
    // SAFETY: `getpwuid` returns a pointer owned by libc for the current user.
    // We immediately copy the `pw_shell` string while reading it and never keep
    // the returned pointer beyond this block.
    unsafe {
        let passwd = libc::getpwuid(libc::geteuid());
        if !passwd.is_null() && !(*passwd).pw_shell.is_null() {
            let shell = CStr::from_ptr((*passwd).pw_shell).to_string_lossy();
            let path = PathBuf::from(shell.as_ref());
            if path.is_file() {
                return path;
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let zsh = PathBuf::from("/bin/zsh");
        if zsh.is_file() {
            return zsh;
        }
    }

    PathBuf::from("sh")
}

fn uses_interactive_config(shell: &Path) -> bool {
    matches!(
        shell.file_name().and_then(|name| name.to_str()),
        Some("bash" | "zsh" | "fish" | "ksh" | "mksh")
    )
}

/// Run `command -v` in the user's actual login shell. Interactive config is
/// intentionally loaded for shells that support it: CLIs installed through
/// nvm, fnm, asdf, Homebrew, or a user-managed `~/.local/bin` often appear
/// only there, while GUI applications otherwise inherit a minimal PATH.
fn resolve_via_login_shell(program: &str) -> Option<PathBuf> {
    let shell = user_login_shell();
    let script = format!("command -v {}", shell_quote(program));
    let args = if uses_interactive_config(&shell) {
        "-lic"
    } else {
        "-lc"
    };
    let output = Command::new(shell).arg(args).arg(script).output().ok()?;

    if !output.status.success() {
        return None;
    }

    // Startup files occasionally print a banner. `command -v` writes its
    // result last, so scanning backwards makes detection robust without
    // treating any arbitrary line as executable input.
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .find(|candidate| candidate.is_file())
}

/// Resolve a binary name or absolute path to an executable path.
/// Uses the current process PATH first, then falls back to the actual user's
/// login shell. This lets GUI-launched apps find Homebrew, nvm, and other
/// tools configured for the user's terminal.
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
        if !path.is_file() {
            return Err(format!("program does not exist: {program}"));
        }
        return Ok(path.to_path_buf());
    }

    // Search current process PATH.
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(program);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    if let Some(candidate) = resolve_via_login_shell(program) {
        return Ok(candidate);
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

        if resolve_binary_path(&bin).is_ok() {
            found.push(bin);
        }
    }

    Ok(found)
}
