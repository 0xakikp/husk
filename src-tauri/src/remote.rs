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

#[derive(Debug, Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    is_symlink: bool,
}

fn scoped_existing_cmd(root: &str, path: &str, action: &str) -> String {
    format!(
        "root=$(realpath {}) || exit 70; target=$(realpath {}) || exit 71; \
         if [ \"$root\" != / ]; then case \"$target\" in \"$root\"|\"$root\"/*) ;; *) echo 'Path is outside the enabled remote workspace' >&2; exit 77;; esac; fi; {}",
        shq(root), shq(path), action,
    )
}

// NUL-framed type/name pairs preserve whitespace, newlines, '*' and symlinks.
// Never parse ls's presentation output into paths used for file mutations.
const LIST_DIRECTORY: &str = r#"[ -d "$target" ] && [ -r "$target" ] && [ -x "$target" ] || { printf '%s\n' 'Directory is unavailable or permission was denied' >&2; exit 66; };
for item in "$target"/.[!.]* "$target"/..?* "$target"/*; do
    [ -e "$item" ] || [ -L "$item" ] || continue;
    name=${item##*/}; kind=f;
    if [ -L "$item" ]; then kind=l; [ ! -d "$item" ] || kind=L;
    elif [ -d "$item" ]; then kind=d; fi;
    printf '%s\000%s\000' "$kind" "$name";
done"#;

fn parse_dir_entries(output: &str, path: &str) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    if output.is_empty() {
        return Ok(entries);
    }
    let body = output
        .strip_suffix('\0')
        .ok_or("Remote directory listing was incomplete")?;
    let mut fields = body.split('\0');
    while let Some(kind) = fields.next() {
        let name = fields
            .next()
            .ok_or("Remote directory listing was incomplete")?;
        if !matches!(kind, "d" | "f" | "l" | "L")
            || name.is_empty()
            || name == "."
            || name == ".."
            || name.contains('/')
        {
            return Err("Remote directory listing contained an invalid entry".into());
        }
        entries.push(DirEntry {
            name: name.to_string(),
            path: format!("{}/{}", path.trim_end_matches('/'), name),
            is_dir: matches!(kind, "d" | "L"),
            is_symlink: matches!(kind, "l" | "L"),
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

fn validate_remote_path(path: &str) -> Result<(), String> {
    if !path.starts_with('/') || path.contains('\0') || path.split('/').any(|part| part == "..") {
        return Err("Remote paths must be absolute and cannot contain parent traversal".into());
    }
    Ok(())
}

fn directory_command(path: &str) -> Result<String, String> {
    validate_remote_path(path)?;
    Ok(format!("target={}; {}", shq(path), LIST_DIRECTORY))
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
pub async fn ssh_read_dir(host: String, path: String) -> Result<Vec<DirEntry>, String> {
    crate::shell::run_blocking_command(move || ssh_read_dir_impl(host, path)).await
}

fn ssh_read_dir_impl(host: String, path: String) -> Result<Vec<DirEntry>, String> {
    let output = ssh_stdout(&host, &directory_command(&path)?)?;
    parse_dir_entries(&output, &path)
}

#[tauri::command]
pub async fn ssh_read_dir_scoped(
    host: String,
    root: String,
    path: String,
) -> Result<Vec<DirEntry>, String> {
    crate::shell::run_blocking_command(move || ssh_read_dir_scoped_impl(host, root, path)).await
}

fn ssh_read_dir_scoped_impl(
    host: String,
    root: String,
    path: String,
) -> Result<Vec<DirEntry>, String> {
    validate_scoped_paths(&root, &path)?;
    let output = ssh_stdout(&host, &scoped_existing_cmd(&root, &path, LIST_DIRECTORY))?;
    parse_dir_entries(&output, &path)
}

#[tauri::command]
pub async fn ssh_read_file(host: String, path: String) -> Result<String, String> {
    crate::shell::run_blocking_command(move || ssh_read_file_impl(host, path)).await
}

fn ssh_read_file_impl(host: String, path: String) -> Result<String, String> {
    validate_remote_path(&path)?;
    ssh_stdout(&host, &format!("cat {}", shq(&path)))
}

#[tauri::command]
pub async fn ssh_read_file_scoped(
    host: String,
    root: String,
    path: String,
) -> Result<String, String> {
    crate::shell::run_blocking_command(move || ssh_read_file_scoped_impl(host, root, path)).await
}

fn ssh_read_file_scoped_impl(host: String, root: String, path: String) -> Result<String, String> {
    validate_scoped_paths(&root, &path)?;
    ssh_stdout(&host, &scoped_existing_cmd(&root, &path, "cat \"$target\""))
}

#[tauri::command]
pub async fn ssh_write_file(host: String, path: String, contents: String) -> Result<(), String> {
    crate::shell::run_blocking_command(move || ssh_write_file_impl(host, path, contents)).await
}

fn ssh_write_file_impl(host: String, path: String, contents: String) -> Result<(), String> {
    validate_remote_path(&path)?;
    ssh_stdin(&host, &format!("tee {}", shq(&path)), &contents, "write")
}

#[tauri::command]
pub async fn ssh_write_file_scoped(
    host: String,
    root: String,
    path: String,
    contents: String,
) -> Result<(), String> {
    crate::shell::run_blocking_command(move || {
        ssh_write_file_scoped_impl(host, root, path, contents)
    })
    .await
}

fn ssh_write_file_scoped_impl(
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
pub async fn ssh_create_file_scoped(
    host: String,
    root: String,
    path: String,
    contents: String,
) -> Result<(), String> {
    crate::shell::run_blocking_command(move || {
        ssh_create_file_scoped_impl(host, root, path, contents)
    })
    .await
}

fn ssh_create_file_scoped_impl(
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
    let name = &path[slash + 1..];
    if name.is_empty() || name == "." || name == ".." || name.contains('/') {
        return Err("Invalid remote file name".to_string());
    }
    let remote_cmd = python_command(CREATE_SCOPED_EXCLUSIVE, &[&root, &path]);
    ssh_stdin(&host, &remote_cmd, &contents, "create")
}

#[tauri::command]
pub async fn ssh_delete_file_scoped(
    host: String,
    root: String,
    path: String,
) -> Result<(), String> {
    crate::shell::run_blocking_command(move || ssh_delete_file_scoped_impl(host, root, path)).await
}

fn ssh_delete_file_scoped_impl(host: String, root: String, path: String) -> Result<(), String> {
    validate_scoped_paths(&root, &path)?;
    ssh_stdout(
        &host,
        &scoped_existing_cmd(&root, &path, "test -f \"$target\" && rm -f \"$target\""),
    )?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_create_file(host: String, path: String) -> Result<(), String> {
    crate::shell::run_blocking_command(move || ssh_create_file_impl(host, path)).await
}

fn ssh_create_file_impl(host: String, path: String) -> Result<(), String> {
    validate_remote_path(&path)?;
    ssh_stdout(
        &host,
        &python_command("import sys\nwith open(sys.argv[1], 'xb'): pass", &[&path]),
    )?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_create_dir(host: String, path: String) -> Result<(), String> {
    crate::shell::run_blocking_command(move || ssh_create_dir_impl(host, path)).await
}

fn ssh_create_dir_impl(host: String, path: String) -> Result<(), String> {
    validate_remote_path(&path)?;
    ssh_stdout(&host, &format!("mkdir {}", shq(&path)))?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_rename_path(host: String, from: String, to: String) -> Result<(), String> {
    crate::shell::run_blocking_command(move || ssh_rename_path_impl(host, from, to)).await
}

fn ssh_rename_path_impl(host: String, from: String, to: String) -> Result<(), String> {
    validate_remote_transfer(&from, &to)?;
    let command = python_command(RENAME_EXCLUSIVE, &[&from, &to]);
    ssh_stdout(&host, &command)?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_copy_path(host: String, from: String, to: String) -> Result<(), String> {
    crate::shell::run_blocking_command(move || ssh_copy_path_impl(host, from, to)).await
}

fn ssh_copy_path_impl(host: String, from: String, to: String) -> Result<(), String> {
    validate_remote_transfer(&from, &to)?;
    let command = python_command(COPY_EXCLUSIVE, &[&from, &to]);
    ssh_stdout(&host, &command)?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_delete_path(host: String, path: String) -> Result<(), String> {
    crate::shell::run_blocking_command(move || ssh_delete_path_impl(host, path)).await
}

fn ssh_delete_path_impl(host: String, path: String) -> Result<(), String> {
    validate_remote_path(&path)?;
    if path.split('/').all(|part| part.is_empty() || part == ".") {
        return Err("Refusing to delete a remote filesystem root".into());
    }
    ssh_stdout(&host, &format!("rm -rf {}", shq(&path)))?;
    Ok(())
}

fn validate_remote_transfer(from: &str, to: &str) -> Result<(), String> {
    validate_remote_path(from)?;
    validate_remote_path(to)?;
    let source = from.trim_end_matches('/');
    let destination = to.trim_end_matches('/');
    if source.is_empty() || destination.is_empty() {
        return Err("Cannot copy or rename a filesystem root".into());
    }
    if source == destination {
        return Err("Choose a different destination".into());
    }
    if destination.starts_with(&format!("{source}/")) {
        return Err("A folder cannot be placed inside itself".into());
    }
    Ok(())
}

// A fixed helper, with paths passed as argv, is necessary for an actual
// no-overwrite guarantee: portable mv/cp preflight checks race other writers.
// Hosts without Python 3 or a supported exclusive-rename syscall fail safely.
fn python_command(script: &str, paths: &[&str]) -> String {
    format!("command -v python3 >/dev/null 2>&1 || {{ printf '%s\\n' 'Safe file operations require Python 3 on this host; nothing was changed' >&2; exit 69; }}; python3 -c {} {}",
        shq(script), paths.iter().map(|path| shq(path)).collect::<Vec<_>>().join(" "))
}

// os.link always addresses the exact destination. Unlike the ln utility, it
// never treats an existing destination directory as a folder to copy into.
const CREATE_SCOPED_EXCLUSIVE: &str = r#"import os, sys, tempfile
root, destination = sys.argv[1:]
try:
    root = os.path.realpath(root)
    parent = os.path.realpath(os.path.dirname(destination))
    if not os.path.isdir(root) or os.path.commonpath([root, parent]) != root:
        raise OSError('Path is outside the enabled remote workspace')
    payload = sys.stdin.buffer.read(256 * 1024 + 1)
    if len(payload) > 256 * 1024:
        raise OSError('Remote write exceeds the 256 KiB limit')
    with tempfile.NamedTemporaryFile(mode='wb', prefix='.husk.', dir=parent) as temporary:
        temporary.write(payload)
        temporary.flush()
        os.link(temporary.name, os.path.join(parent, os.path.basename(destination)), follow_symlinks=False)
except OSError as error:
    sys.exit('Create refused: ' + str(error))
"#;

const RENAME_EXCLUSIVE: &str = r#"import ctypes, os, sys
source, destination = sys.argv[1:]
libc = ctypes.CDLL(None, use_errno=True)
if sys.platform == 'darwin':
    rename = getattr(libc, 'renameatx_np', None); flags = 4; current = -2
elif sys.platform.startswith('linux'):
    rename = getattr(libc, 'renameat2', None); flags = 1; current = -100
else:
    rename = None
if rename is None:
    sys.exit('Safe no-overwrite rename is unavailable on this host; nothing was changed')
rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
rename.restype = ctypes.c_int
if rename(current, os.fsencode(source), current, os.fsencode(destination), flags) != 0:
    sys.exit('Rename refused: ' + os.strerror(ctypes.get_errno()))
"#;

const COPY_EXCLUSIVE: &str = r#"import os, shutil, stat, sys
source, destination = sys.argv[1:]
def copy(source, destination):
    metadata = os.lstat(source)
    if stat.S_ISLNK(metadata.st_mode):
        raise OSError('Symlink copies are not supported; use SFTP')
    if stat.S_ISDIR(metadata.st_mode):
        os.mkdir(destination)
        for name in os.listdir(source):
            copy(os.path.join(source, name), os.path.join(destination, name))
    elif stat.S_ISREG(metadata.st_mode):
        flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
        with os.fdopen(os.open(source, flags), 'rb') as reader:
            if not stat.S_ISREG(os.fstat(reader.fileno()).st_mode):
                raise OSError('Source changed; only regular files can be copied')
            with open(destination, 'xb') as writer:
                shutil.copyfileobj(reader, writer)
                os.fchmod(writer.fileno(), stat.S_IMODE(metadata.st_mode))
    else:
        raise OSError('Only regular files and folders can be copied')
try:
    resolved_source = os.path.realpath(source)
    resolved_destination = os.path.realpath(destination)
    if os.path.commonpath([resolved_source, resolved_destination]) == resolved_source:
        raise OSError('A folder cannot be copied inside itself')
    copy(source, destination)
except OSError as error:
    sys.exit('Copy did not complete: ' + str(error) + '. A partial copy may remain; no destination was deleted.')
"#;

#[tauri::command]
pub async fn ssh_home_dir(host: String) -> Result<String, String> {
    crate::shell::run_blocking_command(move || {
        let home = ssh_stdout(&host, "echo $HOME")?;
        Ok(home.trim().to_string())
    })
    .await
}

#[tauri::command]
pub async fn ssh_pwd(host: String) -> Result<String, String> {
    crate::shell::run_blocking_command(move || {
        let pwd = ssh_stdout(&host, "pwd")?;
        Ok(pwd.trim().to_string())
    })
    .await
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

    #[test]
    fn framed_directory_listing_preserves_exact_names_and_links() {
        let entries = parse_dir_entries(
            "f\0with spaces*.txt\0d\0folder\nname\0l\0broken -> link\0L\0folder link\0",
            "/project/",
        )
        .unwrap();
        assert_eq!(entries.len(), 4);
        let file = entries
            .iter()
            .find(|entry| entry.name == "with spaces*.txt")
            .unwrap();
        assert_eq!(file.path, "/project/with spaces*.txt");
        assert!(!file.is_dir);
        let link = entries
            .iter()
            .find(|entry| entry.name == "broken -> link")
            .unwrap();
        assert!(link.is_symlink);
        assert!(!link.is_dir);
        assert!(entries
            .iter()
            .any(|entry| entry.name == "folder\nname" && entry.is_dir));
        assert!(entries
            .iter()
            .any(|entry| entry.name == "folder link" && entry.is_dir && entry.is_symlink));
        for malformed in [
            "f\0partial",
            "f\0",
            "f\0../escape\0",
            "x\0name\0",
            "f\0..\0",
        ] {
            assert!(parse_dir_entries(malformed, "/project").is_err());
        }
    }

    #[test]
    fn remote_path_validation_rejects_options_and_traversal_but_allows_names() {
        for path in ["-rf", "relative", "/a/../b", "/a\0b"] {
            assert!(validate_remote_path(path).is_err());
        }
        assert!(validate_remote_path("/a..b/a file\nname").is_ok());
        assert!(validate_remote_transfer("/a", "/a/new").is_err());
        assert!(validate_remote_transfer("/", "/new").is_err());
    }

    #[cfg(unix)]
    fn scratch(label: &str) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "husk-remote-{label}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir(&root).unwrap();
        root
    }

    #[cfg(unix)]
    fn run_local(command: &str) -> Output {
        Command::new("/bin/sh")
            .args(["-c", command])
            .output()
            .unwrap()
    }

    #[cfg(unix)]
    #[test]
    fn portable_listing_command_roundtrips_real_unusual_names_and_missing_directory_errors() {
        use std::fs;
        use std::os::unix::fs::symlink;
        let root = scratch("list");
        let names = [
            "with spaces",
            "line\nbreak",
            "tab\tname",
            "quote'\"$()",
            "star*",
            ".hidden",
        ];
        for name in names {
            fs::write(root.join(name), "test").unwrap();
        }
        fs::create_dir(root.join("folder")).unwrap();
        symlink(root.join("folder"), root.join("dir link")).unwrap();
        symlink(root.join("absent"), root.join("broken link")).unwrap();
        let path = root.to_str().unwrap();
        let output = run_local(&directory_command(path).unwrap());
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let entries = parse_dir_entries(&String::from_utf8(output.stdout).unwrap(), path).unwrap();
        for name in names {
            assert!(entries.iter().any(|entry| entry.name == name));
        }
        assert_eq!(entries.len(), names.len() + 3);
        assert!(entries
            .iter()
            .any(|entry| entry.name == "dir link" && entry.is_dir && entry.is_symlink));
        assert!(entries
            .iter()
            .any(|entry| entry.name == "broken link" && !entry.is_dir && entry.is_symlink));
        assert!(
            !run_local(&directory_command(root.join("missing").to_str().unwrap()).unwrap())
                .status
                .success()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn remote_helpers_refuse_existing_and_broken_symlink_targets_without_deleting_them() {
        use std::fs;
        use std::os::unix::fs::symlink;
        let root = scratch("exclusive");
        let source = root.join("source ' space\nname");
        let destination = root.join("destination");
        fs::write(&source, "source").unwrap();
        fs::write(&destination, "keep me").unwrap();
        let paths = [source.to_str().unwrap(), destination.to_str().unwrap()];
        for script in [RENAME_EXCLUSIVE, COPY_EXCLUSIVE] {
            let output = run_local(&python_command(script, &paths));
            assert!(!output.status.success());
            assert_eq!(fs::read_to_string(&destination).unwrap(), "keep me");
            assert_eq!(fs::read_to_string(&source).unwrap(), "source");
        }
        fs::remove_file(&destination).unwrap();
        symlink(root.join("absent"), &destination).unwrap();
        for script in [RENAME_EXCLUSIVE, COPY_EXCLUSIVE] {
            assert!(!run_local(&python_command(script, &paths)).status.success());
            assert!(fs::symlink_metadata(&destination)
                .unwrap()
                .file_type()
                .is_symlink());
            assert!(!root.join("absent").exists());
        }
        fs::remove_file(&destination).unwrap();
        let output = run_local(&python_command(COPY_EXCLUSIVE, &paths));
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(fs::read_to_string(&destination).unwrap(), "source");
        fs::remove_file(&destination).unwrap();
        let output = run_local(&python_command(RENAME_EXCLUSIVE, &paths));
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(fs::read_to_string(&destination).unwrap(), "source");
        assert!(!source.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn scoped_create_uses_exact_destination_never_nests_inside_an_existing_directory() {
        use std::fs;
        use std::os::unix::fs::symlink;
        let root = scratch("scoped-create");
        let workspace = root.join("workspace");
        let outside = root.join("outside");
        fs::create_dir(&workspace).unwrap();
        fs::create_dir(&outside).unwrap();
        let directory = workspace.join("existing-directory");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("keep.txt"), "keep me").unwrap();
        let existing_file = workspace.join("existing-file");
        fs::write(&existing_file, "existing contents").unwrap();
        let broken_link = workspace.join("broken-link");
        symlink(outside.join("absent"), &broken_link).unwrap();
        symlink(&outside, workspace.join("escape")).unwrap();
        for destination in [
            &directory,
            &existing_file,
            &broken_link,
            &workspace.join("escape/new"),
        ] {
            let output = run_local(&python_command(
                CREATE_SCOPED_EXCLUSIVE,
                &[workspace.to_str().unwrap(), destination.to_str().unwrap()],
            ));
            assert!(!output.status.success());
        }
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        assert_eq!(
            fs::read_to_string(&existing_file).unwrap(),
            "existing contents"
        );
        assert!(fs::symlink_metadata(&broken_link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
        assert!(!fs::read_dir(&workspace).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".husk.")));
        let destination = workspace.join("new ' file");
        let command = python_command(
            CREATE_SCOPED_EXCLUSIVE,
            &[workspace.to_str().unwrap(), destination.to_str().unwrap()],
        );
        let mut child = Command::new("/bin/sh")
            .args(["-c", &command])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(b"reviewed contents\n")
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            fs::read_to_string(&destination).unwrap(),
            "reviewed contents\n"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
