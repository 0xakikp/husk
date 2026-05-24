//! One-shot shell command runner (distinct from the interactive PTY).
//! Used by the docker / kubernetes / terraform clients to run a CLI and
//! capture its output, with a timeout and output cap.

use std::process::Command;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use serde::Serialize;

const MAX_OUT: usize = 256 * 1024;

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
    command: String,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<ShellOutput, String> {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(20));
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        // Login shell so PATH includes brew/user bins (docker, kubectl, …).
        #[cfg(windows)]
        let output = {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(&command);
            if let Some(dir) = cwd {
                c.current_dir(dir);
            }
            c.output()
        };
        #[cfg(not(windows))]
        let output = {
            let mut c = Command::new("sh");
            c.arg("-lc").arg(&command);
            if let Some(dir) = cwd {
                c.current_dir(dir);
            }
            c.output()
        };
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
