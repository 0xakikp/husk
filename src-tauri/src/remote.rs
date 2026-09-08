//! SSH remote filesystem commands.
//! Spawns `ssh host "command"` subprocesses to reuse the user's existing
//! SSH config, keys, and agent.

use std::io::{Read, Write};
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::sync::Arc;
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

fn complete_remote_text(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() > MAX_OUT {
        return Err("Remote content exceeds the 256 KiB limit; nothing was changed. Use SFTP or a local editor for larger files.".to_string());
    }
    String::from_utf8(bytes)
        .map_err(|_| "Remote content is not UTF-8 text; nothing was changed.".to_string())
}

/// Pass file content over stdin, never a shell argument. Bound both output
/// pipes and kill the SSH child on timeout instead of abandoning a live writer.
fn run_ssh(host: &str, cmd: &str, input: Option<&str>) -> Result<Output, String> {
    validate_host(host)?;
    let mut command = Command::new("ssh");
    command.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", host, cmd]);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child =
        Arc::new(shared_child::SharedChild::spawn(&mut command).map_err(|e| e.to_string())?);
    let mut stdin = child.take_stdin().ok_or("No SSH stdin")?;
    let stdout = child.take_stdout().ok_or("No SSH stdout")?;
    let stderr = child.take_stderr().ok_or("No SSH stderr")?;
    let contents = input.unwrap_or("").as_bytes().to_vec();
    let writer = std::thread::spawn(move || stdin.write_all(&contents));
    let collect = |reader: Box<dyn Read + Send>, child: Arc<shared_child::SharedChild>| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let result = reader.take((MAX_OUT + 1) as u64).read_to_end(&mut bytes);
            if bytes.len() > MAX_OUT {
                let _ = child.kill();
            }
            result.map(|_| bytes)
        })
    };
    let out = collect(Box::new(stdout), child.clone());
    let err = collect(Box::new(stderr), child.clone());
    let (tx, rx) = mpsc::channel();
    let waiter = child.clone();
    std::thread::spawn(move || {
        let result = (|| -> Result<Output, String> {
            let status = waiter.wait().map_err(|e| e.to_string())?;
            let stdout = out
                .join()
                .map_err(|_| "SSH output reader failed")?
                .map_err(|e| e.to_string())?;
            let stderr = err
                .join()
                .map_err(|_| "SSH error reader failed")?
                .map_err(|e| e.to_string())?;
            writer
                .join()
                .map_err(|_| "SSH input writer failed")?
                .map_err(|e| e.to_string())?;
            if stdout.len() > MAX_OUT || stderr.len() > MAX_OUT {
                return Err(
                    "Remote output exceeds the 256 KiB limit; a complete read is required.".into(),
                );
            }
            Ok(Output {
                status,
                stdout,
                stderr,
            })
        })();
        let _ = tx.send(result);
    });
    match rx.recv_timeout(Duration::from_secs(SSH_TIMEOUT)) {
        Ok(result) => result,
        Err(_) => {
            let _ = child.kill();
            Err("SSH command timed out; the connection was stopped. Check the remote file before retrying a write.".to_string())
        }
    }
}

/// Run an SSH command and return stdout on success.
fn ssh_stdout(host: &str, cmd: &str) -> Result<String, String> {
    let output = run_ssh(host, cmd, None)?;
    if !output.status.success() {
        return Err(format!(
            "SSH failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    complete_remote_text(output.stdout)
}

fn ssh_stdin(host: &str, cmd: &str, contents: &str, label: &str) -> Result<(), String> {
    if contents.len() > MAX_OUT {
        return Err("Remote write exceeds the 256 KiB limit; nothing was changed.".to_string());
    }
    let output = run_ssh(host, cmd, Some(contents))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "SSH {label} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
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
    let source = from.trim_end_matches('/');
    let destination = to.trim_end_matches('/');
    if source == destination {
        return Err("Choose a different destination".to_string());
    }
    if destination.starts_with(&format!("{source}/")) {
        return Err("A folder cannot be moved inside itself".to_string());
    }
    let command = format!(
        "if [ ! -e {from} ]; then echo 'Source no longer exists' >&2; exit 66; fi; \
         if [ -e {to} ]; then echo 'An item with that name already exists' >&2; exit 73; fi; \
         mv -- {from} {to}",
        from = shq(&from),
        to = shq(&to),
    );
    ssh_stdout(&host, &command)?;
    Ok(())
}

#[tauri::command]
pub fn ssh_copy_path(host: String, from: String, to: String) -> Result<(), String> {
    let source = from.trim_end_matches('/');
    let destination = to.trim_end_matches('/');
    if source == destination {
        return Err("Choose a different destination".to_string());
    }
    if destination.starts_with(&format!("{source}/")) {
        return Err("A folder cannot be copied inside itself".to_string());
    }
    let command = format!(
        "if [ ! -e {from} ]; then echo 'Source no longer exists' >&2; exit 66; fi; \
         if [ -e {to} ]; then echo 'An item with that name already exists' >&2; exit 73; fi; \
         cp -Rp -- {from} {to}",
        from = shq(&from),
        to = shq(&to),
    );
    ssh_stdout(&host, &command)?;
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

#[cfg(test)]
mod ai_remote_tests {
    use super::*;

    #[test]
    fn oversized_read_is_refused_instead_of_becoming_editable_prefix() {
        assert_eq!(
            complete_remote_text(vec![b'a'; MAX_OUT]).unwrap().len(),
            MAX_OUT
        );
        assert!(complete_remote_text(vec![b'a'; MAX_OUT + 1])
            .unwrap_err()
            .contains("256 KiB"));
    }

    #[test]
    fn binary_content_is_never_lossily_rewritten_as_text() {
        assert!(complete_remote_text(vec![0xff, 0xfe]).is_err());
        assert_eq!(
            complete_remote_text("hello é".as_bytes().to_vec()).unwrap(),
            "hello é"
        );
    }

    #[test]
    fn large_write_is_rejected_before_ssh_is_started() {
        assert!(
            ssh_stdin("invalid host", "unused", &"x".repeat(MAX_OUT + 1), "write")
                .unwrap_err()
                .contains("256 KiB")
        );
    }
}
