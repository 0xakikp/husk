//! SSH remote filesystem commands.
//! Spawns `ssh host "command"` subprocesses to reuse the user's existing
//! SSH config, keys, and agent.

use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;

const MAX_OUT: usize = 256 * 1024;
const SSH_TIMEOUT: u64 = 15;

fn validate_host(host: &str) -> Result<(), String> {
    let valid = !host.is_empty()
        && host.len() <= 255
        && !host.starts_with('-')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_.:@[]-".contains(c));
    if valid {
        Ok(())
    } else {
        Err("Invalid SSH target".to_string())
    }
}

fn validate_scoped_paths(root: &str, path: &str) -> Result<(), String> {
    let valid = |value: &str| {
        value.starts_with('/')
            && !value.contains('\0')
            && !value.contains('\n')
            && !value.contains('\r')
    };
    if valid(root) && valid(path) {
        Ok(())
    } else {
        Err("Remote workspace paths must be absolute".to_string())
    }
}

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

fn scoped_existing_cmd(root: &str, path: &str, action: &str) -> String {
    format!(
        "root=$(realpath {}) || exit 70; target=$(realpath {}) || exit 71; \
         if [ \"$root\" != / ]; then case \"$target\" in \"$root\"|\"$root\"/*) ;; *) echo 'Path is outside the enabled remote workspace' >&2; exit 77;; esac; fi; {}",
        shq(root), shq(path), action,
    )
}

fn parse_dir_entries(output: &str, path: &str) -> Vec<DirEntry> {
    let mut entries: Vec<DirEntry> = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("total ") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }
        let perms = parts[0];
        let name = parts[parts.len() - 1];
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
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries
}

fn parse_scoped_dir_entries(output: &str, path: &str) -> Vec<DirEntry> {
    let mut entries = output
        .lines()
        .filter_map(|line| {
            let (kind, name) = line.split_once('\t')?;
            if name.is_empty() || name == "." || name == ".." || name.contains('/') {
                return None;
            }
            Some(DirEntry {
                name: name.to_string(),
                path: format!("{}/{}", path.trim_end_matches('/'), name),
                is_dir: kind == "d",
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries
}

/// Run an SSH command and return stdout on success.
fn ssh_stdout(host: &str, cmd: &str) -> Result<String, String> {
    validate_host(host)?;
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

fn ssh_stdin(host: &str, cmd: &str, contents: &str, label: &str) -> Result<(), String> {
    validate_host(host)?;
    let ssh_cmd = format!(
        "printf '%s' {} | ssh -o BatchMode=yes -o ConnectTimeout=5 {} {}",
        shq(contents),
        shq(host),
        shq(cmd),
    );
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        #[cfg(not(windows))]
        let output = Command::new("sh").arg("-lc").arg(&ssh_cmd).output();
        #[cfg(windows)]
        let output = Command::new("cmd").arg("/C").arg(&ssh_cmd).output();
        let _ = tx.send(output);
    });
    match rx.recv_timeout(Duration::from_secs(SSH_TIMEOUT)) {
        Ok(Ok(output)) if output.status.success() => Ok(()),
        Ok(Ok(output)) => Err(format!(
            "SSH {label} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )),
        Ok(Err(e)) => Err(format!("Failed to spawn ssh: {e}")),
        Err(_) => Err(format!("SSH {label} timed out")),
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

    Ok(parse_dir_entries(&output, &path))
}

#[tauri::command]
pub fn ssh_read_dir_scoped(
    host: String,
    root: String,
    path: String,
) -> Result<Vec<DirEntry>, String> {
    validate_scoped_paths(&root, &path)?;
    let output = ssh_stdout(&host, &scoped_existing_cmd(
        &root,
        &path,
        "for item in \"$target\"/.[!.]* \"$target\"/..?* \"$target\"/*; do [ -e \"$item\" ] || continue; name=${item##*/}; if [ -d \"$item\" ]; then kind=d; else kind=f; fi; printf '%s\\t%s\\n' \"$kind\" \"$name\"; done",
    ))?;
    Ok(parse_scoped_dir_entries(&output, &path))
}

#[tauri::command]
pub fn ssh_read_file(host: String, path: String) -> Result<String, String> {
    ssh_stdout(&host, &format!("cat {}", shq(&path)))
}

#[tauri::command]
pub fn ssh_read_file_scoped(host: String, root: String, path: String) -> Result<String, String> {
    validate_scoped_paths(&root, &path)?;
    ssh_stdout(&host, &scoped_existing_cmd(&root, &path, "cat \"$target\""))
}

#[tauri::command]
pub fn ssh_write_file(host: String, path: String, contents: String) -> Result<(), String> {
    ssh_stdin(&host, &format!("tee {}", shq(&path)), &contents, "write")
}

#[tauri::command]
pub fn ssh_write_file_scoped(
    host: String,
    root: String,
    path: String,
    contents: String,
) -> Result<(), String> {
    validate_scoped_paths(&root, &path)?;
    let remote_cmd = scoped_existing_cmd(
        &root,
        &path,
        "parent=${target%/*}; [ -n \"$parent\" ] || parent=/; tmp=$(mktemp \"$parent/.husk.XXXXXX\") || exit 72; cp -p \"$target\" \"$tmp\" || { rm -f \"$tmp\"; exit 73; }; cat > \"$tmp\" && mv -f \"$tmp\" \"$target\"; status=$?; rm -f \"$tmp\"; exit $status",
    );
    ssh_stdin(&host, &remote_cmd, &contents, "write")
}

#[tauri::command]
pub fn ssh_create_file_scoped(
    host: String,
    root: String,
    path: String,
    contents: String,
) -> Result<(), String> {
    validate_host(&host)?;
    validate_scoped_paths(&root, &path)?;
    let slash = path
        .rfind('/')
        .ok_or_else(|| "Remote file needs an absolute path".to_string())?;
    let parent = if slash == 0 { "/" } else { &path[..slash] };
    let name = &path[slash + 1..];
    if name.is_empty() || name == "." || name == ".." || name.contains('/') {
        return Err("Invalid remote file name".to_string());
    }
    let remote_cmd = format!(
        "root=$(realpath {}) || exit 70; parent=$(realpath {}) || exit 71; \
         if [ \"$root\" != / ]; then case \"$parent\" in \"$root\"|\"$root\"/*) ;; *) echo 'Path is outside the enabled remote workspace' >&2; exit 77;; esac; fi; \
         name={}; tmp=$(mktemp \"$parent/.husk.XXXXXX\") || exit 72; cat > \"$tmp\" && ln \"$tmp\" \"$parent/$name\"; status=$?; rm -f \"$tmp\"; exit $status",
        shq(&root), shq(parent), shq(name),
    );
    ssh_stdin(&host, &remote_cmd, &contents, "create")
}

#[tauri::command]
pub fn ssh_delete_file_scoped(host: String, root: String, path: String) -> Result<(), String> {
    validate_scoped_paths(&root, &path)?;
    ssh_stdout(
        &host,
        &scoped_existing_cmd(&root, &path, "test -f \"$target\" && rm -f \"$target\""),
    )?;
    Ok(())
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
