//! SSH remote filesystem commands.
//! Spawns `ssh host "command"` subprocesses to reuse the user's existing
//! SSH config, keys, and agent.

use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;

const MAX_OUT: usize = 256 * 1024;
const SSH_TIMEOUT: u64 = 15;

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// Run an SSH command and return stdout on success.
fn ssh_stdout(host: &str, cmd: &str) -> Result<String, String> {
    let ssh_cmd = format!(
        "ssh -o BatchMode=yes -o ConnectTimeout=5 {} {}",
        shq(host),
        shq(cmd),
    );

    let (tx, rx) = mpsc::channel();

    std::thread::spawn(move || {
        #[cfg(not(windows))]
        let output = {
            let mut c = Command::new("sh");
            c.arg("-lc").arg(&ssh_cmd);
            c.output()
        };
        #[cfg(windows)]
        let output = {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(&ssh_cmd);
            c.output()
        };
        let _ = tx.send(output);
    });

    match rx.recv_timeout(Duration::from_secs(SSH_TIMEOUT)) {
        Ok(Ok(output)) => {
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                return Err(format!(
                    "SSH failed (exit {:?}): {} {}",
                    output.status.code(),
                    err.trim(),
                    stdout.trim(),
                ));
            }
            let out = String::from_utf8_lossy(&output.stdout[..output.stdout.len().min(MAX_OUT)]);
            Ok(out.to_string())
        }
        Ok(Err(e)) => Err(format!("Failed to spawn ssh: {e}")),
        Err(_) => Err("SSH command timed out".to_string()),
    }
}

/// Quote a string for safe shell interpolation.
fn shq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

#[tauri::command]
pub fn ssh_read_dir(host: String, path: String) -> Result<Vec<DirEntry>, String> {
    // Use ls -laF which appends / to directories, * to executables, etc.
    let output = ssh_stdout(&host, &format!("ls -laF {}", shq(&path)))?;

    let mut entries: Vec<DirEntry> = Vec::new();

    for line in output.lines() {
        // Skip total line and hidden entries (. ..)
        let line = line.trim();
        if line.is_empty() || line.starts_with("total ") {
            continue;
        }

        // Parse ls -laF output:
        // drwxr-xr-x  3 user group 4096 Jan 1 00:00 dirname/
        // -rw-r--r--  1 user group  123 Jan 1 00:00 filename
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }

        let perms = parts[0];
        let name = parts[parts.len() - 1];

        // Skip . and ..
        if name == "." || name == ".." {
            continue;
        }

        let is_dir = perms.starts_with('d') || name.ends_with('/');
        let clean_name = name.trim_end_matches('/').trim_end_matches('*');

        entries.push(DirEntry {
            name: clean_name.to_string(),
            path: format!("{}/{}", path.trim_end_matches('/'), clean_name),
            is_dir,
        });
    }

    // Directories first, then case-insensitive by name.
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
pub fn ssh_read_file(host: String, path: String) -> Result<String, String> {
    ssh_stdout(&host, &format!("cat {}", shq(&path)))
}

#[tauri::command]
pub fn ssh_write_file(host: String, path: String, contents: String) -> Result<(), String> {
    let ssh_cmd = format!(
        "printf '%s' {} | ssh -o BatchMode=yes -o ConnectTimeout=5 {} {}",
        shq(&contents),
        shq(&host),
        shq(&format!("tee {}", shq(&path))),
    );

    let (tx, rx) = mpsc::channel();

    std::thread::spawn(move || {
        #[cfg(not(windows))]
        let output = {
            let mut c = Command::new("sh");
            c.arg("-lc").arg(&ssh_cmd);
            c.output()
        };
        #[cfg(windows)]
        let output = {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(&ssh_cmd);
            c.output()
        };
        let _ = tx.send(output);
    });

    match rx.recv_timeout(Duration::from_secs(SSH_TIMEOUT)) {
        Ok(Ok(output)) => {
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                return Err(format!("SSH write failed: {}", err.trim()));
            }
            Ok(())
        }
        Ok(Err(e)) => Err(format!("Failed to spawn ssh: {e}")),
        Err(_) => Err("SSH write timed out".to_string()),
    }
}

#[tauri::command]
pub fn ssh_create_file(host: String, path: String) -> Result<(), String> {
    ssh_stdout(&host, &format!("touch {}", shq(&path)))?;
    Ok(())
}

#[tauri::command]
pub fn ssh_create_dir(host: String, path: String) -> Result<(), String> {
    ssh_stdout(&host, &format!("mkdir -p {}", shq(&path)))?;
    Ok(())
}

#[tauri::command]
pub fn ssh_rename_path(host: String, from: String, to: String) -> Result<(), String> {
    ssh_stdout(&host, &format!("mv {} {}", shq(&from), shq(&to)))?;
    Ok(())
}

#[tauri::command]
pub fn ssh_delete_path(host: String, path: String) -> Result<(), String> {
    ssh_stdout(&host, &format!("rm -rf {}", shq(&path)))?;
    Ok(())
}

#[tauri::command]
pub fn ssh_home_dir(host: String) -> Result<String, String> {
    let home = ssh_stdout(&host, "echo $HOME")?;
    Ok(home.trim().to_string())
}

#[tauri::command]
pub fn ssh_pwd(host: String) -> Result<String, String> {
    let pwd = ssh_stdout(&host, "pwd")?;
    Ok(pwd.trim().to_string())
}
