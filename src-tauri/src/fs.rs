//! Minimal filesystem commands for the file explorer and editor.

use base64::Engine;
use serde::Serialize;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    is_symlink: bool,
}

/// Validate that a path is safe: no parent directory traversal ("..") and must be absolute.
fn validate_path(path: &str) -> Result<&str, String> {
    if Path::new(path)
        .components()
        .any(|part| part == Component::ParentDir)
    {
        return Err("Path traversal not allowed".to_string());
    }
    if path.contains('\0') {
        return Err("Paths cannot contain a NUL byte".to_string());
    }
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err("Path must be absolute".to_string());
    }
    Ok(path)
}

/// Resolve an existing path through symlinks and confirm it remains inside an
/// AI chat's selected workspace. Front-end checks keep the experience clear;
/// this native check is the boundary, so a symlink inside a project cannot make
/// an AI file tool read or write somewhere else on disk.
fn scoped_existing_path(path: &str, root: &str) -> Result<PathBuf, String> {
    validate_path(path)?;
    validate_path(root)?;
    let root = fs::canonicalize(root).map_err(|e| format!("workspace is unavailable: {e}"))?;
    if !root.is_dir() {
        return Err("workspace must be a directory".to_string());
    }
    let resolved = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if resolved.starts_with(&root) {
        Ok(resolved)
    } else {
        Err("path is outside the selected AI workspace".to_string())
    }
}

/// Confirm a new file or directory will be created below an existing folder in
/// the selected workspace. The target itself may not exist yet, so canonicalize
/// the nearest ancestor instead.
fn scoped_destination_path(path: &str, root: &str) -> Result<PathBuf, String> {
    validate_path(path)?;
    validate_path(root)?;
    let root = fs::canonicalize(root).map_err(|e| format!("workspace is unavailable: {e}"))?;
    if !root.is_dir() {
        return Err("workspace must be a directory".to_string());
    }

    let candidate = Path::new(path);
    let mut ancestor = candidate;
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| "could not resolve a parent folder for this path".to_string())?;
    }
    let resolved_ancestor = fs::canonicalize(ancestor).map_err(|e| e.to_string())?;
    if resolved_ancestor.starts_with(&root) {
        Ok(candidate.to_path_buf())
    } else {
        Err("path is outside the selected AI workspace".to_string())
    }
}

fn exact_file_name(name: std::ffi::OsString) -> Result<String, String> {
    name.into_string().map_err(|_| {
        "This folder contains a non-UTF-8 filename; use the system file manager to manage it"
            .to_string()
    })
}

fn read_dir_entries(path: &Path) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .map(|entry| {
            let e = entry.map_err(|e| e.to_string())?;
            let p = e.path();
            Ok(DirEntry {
                name: exact_file_name(e.file_name())?,
                path: p
                    .to_str()
                    .ok_or("This folder contains a non-UTF-8 path")?
                    .to_string(),
                is_dir: p.is_dir(),
                is_symlink: e.file_type().map_err(|e| e.to_string())?.is_symlink(),
            })
        })
        .collect::<Result<_, String>>()?;
    // Directories first, then case-insensitive by name.
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub async fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    crate::shell::run_blocking_command(move || {
        validate_path(&path)?;
        read_dir_entries(Path::new(&path))
    })
    .await
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    validate_path(&path)?;
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// AI-only scoped filesystem operations. General explorer/editor operations
/// retain the commands above; AI paths always carry their selected root and are
/// checked natively against both traversal and symlink escapes.
#[tauri::command]
pub fn read_dir_scoped(path: String, root: String) -> Result<Vec<DirEntry>, String> {
    let path = scoped_existing_path(&path, &root)?;
    read_dir_entries(&path)
}

#[tauri::command]
pub fn read_file_scoped(
    path: String,
    root: String,
    max_bytes: Option<usize>,
) -> Result<String, String> {
    let path = scoped_existing_path(&path, &root)?;
    let max_bytes = max_bytes.unwrap_or(2 * 1024 * 1024).min(2 * 1024 * 1024);
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("AI workspace reads require a regular file".to_string());
    }
    if metadata.len() > max_bytes as u64 {
        return Err(format!(
            "File exceeds the AI read limit of {max_bytes} bytes; no partial content was returned"
        ));
    }
    let mut contents = Vec::new();
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut contents)
        .map_err(|e| e.to_string())?;
    if contents.len() > max_bytes {
        return Err(format!(
            "File exceeds the AI read limit of {max_bytes} bytes; no partial content was returned"
        ));
    }
    String::from_utf8(contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file_scoped(path: String, contents: String, root: String) -> Result<(), String> {
    let path = if Path::new(&path).exists() {
        scoped_existing_path(&path, &root)?
    } else {
        scoped_destination_path(&path, &root)?
    };
    fs::write(path, contents).map_err(|e| e.to_string())
}

/// Create a new file without ever replacing an existing path. The review flow
/// uses this for AI-proposed creates so an approval cannot turn into an
/// overwrite between the preview and the filesystem write.
#[tauri::command]
pub fn write_new_file_scoped(path: String, contents: String, root: String) -> Result<(), String> {
    let path = scoped_destination_path(&path, &root)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                format!("a file already exists at {}", path.to_string_lossy())
            } else {
                e.to_string()
            }
        })?;
    file.write_all(contents.as_bytes())
        .map_err(|e| e.to_string())
}

/// Remove only a regular file that remains in the selected workspace. This is
/// used by Undo for a Husk-created file; symlinks are refused rather than
/// followed so an external replacement cannot redirect the delete.
#[tauri::command]
pub fn delete_file_scoped(path: String, root: String) -> Result<(), String> {
    validate_path(&path)?;
    validate_path(&root)?;
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("refusing to delete a symlink through an AI workspace action".to_string());
    }
    let path = scoped_existing_path(&path, &root)?;
    if !path.is_file() {
        return Err("only files can be removed by undo".to_string());
    }
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_dir_scoped(path: String, root: String) -> Result<(), String> {
    let path = scoped_destination_path(&path, &root)?;
    create_directory_exclusively(&path)
}

#[tauri::command]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    validate_path(&path)?;
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    validate_path(&path)?;
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    validate_path(&path)?;
    fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| "/".to_string())
}

/// Create a new empty file. Fails if it already exists.
#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    validate_path(&path)?;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Read a file and return its contents as a base64 data URL.
#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    validate_path(&path)?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let ext = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");
    let mime = match ext.to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    };
    Ok(format!("data:{mime};base64,{encoded}"))
}

fn create_directory_exclusively(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::create_dir(path).map_err(|e| e.to_string())
}

/// Create missing parents, then atomically create the final directory without merging.
#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    validate_path(&path)?;
    create_directory_exclusively(Path::new(&path))
}

fn validate_copy_source(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "refusing to copy symlink: {}",
            path.to_string_lossy()
        ));
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            validate_copy_source(&entry.map_err(|e| e.to_string())?.path())?;
        }
    } else if !metadata.is_file() {
        return Err(format!(
            "unsupported filesystem item: {}",
            path.to_string_lossy()
        ));
    }
    Ok(())
}

fn copy_path_entry(from: &Path, to: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(from).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "refusing to copy symlink: {}",
            from.to_string_lossy()
        ));
    }
    if metadata.is_dir() {
        fs::create_dir(to).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_path_entry(&entry.path(), &to.join(entry.file_name()))?;
        }
        fs::set_permissions(to, metadata.permissions()).map_err(|e| e.to_string())?;
        return Ok(());
    }

    if !metadata.is_file() {
        return Err(format!(
            "unsupported filesystem item: {}",
            from.to_string_lossy()
        ));
    }

    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut source = options.open(from).map_err(|e| e.to_string())?;
    let source_metadata = source.metadata().map_err(|e| e.to_string())?;
    if !source_metadata.is_file() {
        return Err("Source changed; only regular files can be copied".into());
    }
    let mut destination = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)
        .map_err(|e| e.to_string())?;
    io::copy(&mut source, &mut destination).map_err(|e| e.to_string())?;
    destination
        .set_permissions(source_metadata.permissions())
        .map_err(|e| e.to_string())
}

/// Copy a regular file or directory tree without overwriting. Symlinks are
/// refused so a Vault copy cannot unexpectedly reach outside the visible tree.
#[tauri::command]
pub async fn copy_path(from: String, to: String) -> Result<(), String> {
    crate::shell::run_blocking_command(move || copy_path_impl(from, to)).await
}

fn copy_path_impl(from: String, to: String) -> Result<(), String> {
    validate_path(&from)?;
    validate_path(&to)?;
    let from_path = Path::new(&from);
    let to_path = Path::new(&to);
    if !from_path.exists() {
        return Err(format!("not found: {from}"));
    }
    if fs::symlink_metadata(to_path).is_ok() {
        return Err(format!("already exists: {to}"));
    }
    let canonical_source = fs::canonicalize(from_path).map_err(|e| e.to_string())?;
    let parent = to_path
        .parent()
        .ok_or("Destination needs a parent folder")?;
    let canonical_parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
    if from_path.is_dir() && canonical_parent.starts_with(&canonical_source) {
        return Err("cannot copy a folder into itself".to_string());
    }
    validate_copy_source(from_path)?;
    copy_preserving_destination(from_path, to_path)
}

fn copy_preserving_destination(from_path: &Path, to_path: &Path) -> Result<(), String> {
    if let Err(error) = copy_path_entry(from_path, to_path) {
        // Never clean up by destination path: another process may have created
        // or replaced it after our check. Preserve everything for review.
        return Err(format!("Copy did not complete: {error}. A partial copy may remain; no destination was deleted."));
    }
    Ok(())
}

/// Rename or move a path. Refuses to overwrite an existing target.
#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    validate_path(&from)?;
    validate_path(&to)?;
    rename_without_replace(Path::new(&from), Path::new(&to)).map_err(|e| e.to_string())
}

/// The exclusivity must be enforced by the filesystem, not exists()+rename().
fn rename_without_replace(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let from = CString::new(from.as_os_str().as_bytes())?;
        let to = CString::new(to.as_os_str().as_bytes())?;
        // SAFETY: both C strings remain alive for this call. The OS performs
        // the single atomic rename and refuses any existing destination.
        let result = unsafe {
            #[cfg(target_os = "macos")]
            {
                libc::renameatx_np(
                    libc::AT_FDCWD,
                    from.as_ptr(),
                    libc::AT_FDCWD,
                    to.as_ptr(),
                    libc::RENAME_EXCL,
                )
            }
            #[cfg(target_os = "linux")]
            {
                libc::syscall(
                    libc::SYS_renameat2,
                    libc::AT_FDCWD,
                    from.as_ptr(),
                    libc::AT_FDCWD,
                    to.as_ptr(),
                    libc::RENAME_NOREPLACE,
                )
            }
        };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
        }
        let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        // SAFETY: valid NUL-terminated strings; flags=0 never replaces a target.
        if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } != 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (from, to);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Safe no-overwrite rename is unavailable on this platform",
        ))
    }
}

#[cfg(target_os = "macos")]
const TRASH_SCRIPT: &str = r#"ObjC.import('Foundation');
function run(argv) {
    var error = Ref();
    var destination = Ref();
    var ok = $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError(
        $.NSURL.fileURLWithPath(argv[0]), destination, error);
    if (!ok) throw new Error(error[0] ? ObjC.unwrap(error[0].localizedDescription) : 'Move to Trash failed');
}"#;

fn trash_command(path: &str) -> Result<std::process::Command, String> {
    validate_path(path)?;
    if Path::new(path).parent().is_none() || Path::new(path) == Path::new(&home_dir()) {
        return Err("Refusing to move a filesystem root or your home folder to Trash".into());
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("/usr/bin/osascript");
        command.args(["-l", "JavaScript", "-e", TRASH_SCRIPT, "--", path]);
        Ok(command)
    }
    #[cfg(target_os = "linux")]
    {
        let mut command = std::process::Command::new("gio");
        command.args(["trash", "--", path]);
        Ok(command)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    Err("Move to Trash is unavailable on this platform. Use the system file manager; nothing was deleted.".into())
}

/// A recoverable explorer delete. Never falls back to permanent deletion.
#[tauri::command]
pub async fn trash_path(path: String) -> Result<(), String> {
    let command = trash_command(&path)?;
    crate::shell::run_blocking_command(move || {
        let output = crate::shell::run_captured(command, std::time::Duration::from_secs(20))
            .map_err(|e| format!("Trash is unavailable: {e}. No permanent delete was attempted."))?;
        if output.timed_out {
            return Err("Move to Trash timed out. Check the folder and Trash before retrying; no permanent delete was attempted.".into());
        }
        if output.exit_code != Some(0) {
            return Err(format!("Move to Trash failed: {}. No permanent delete was attempted.", output.stderr.trim()));
        }
        Ok(())
    }).await
}

/// Delete a file, or a directory and all of its contents.
#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    validate_path(&path)?;
    let p = Path::new(&path);
    let meta = fs::symlink_metadata(p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{copy_path_impl as copy_path, read_file_scoped, write_new_file_scoped};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("husk-fs-{name}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn scoped_reads_refuse_partial_or_invalid_text_and_creates_never_overwrite() {
        let root = scratch("bounded-read");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("file.txt").to_string_lossy().to_string();
        let scope = root.to_string_lossy().to_string();
        fs::write(&path, "original").unwrap();
        assert!(read_file_scoped(path.clone(), scope.clone(), Some(3))
            .unwrap_err()
            .contains("no partial content"));
        assert_eq!(
            read_file_scoped(path.clone(), scope.clone(), Some(8)).unwrap(),
            "original"
        );
        assert!(write_new_file_scoped(path.clone(), "replacement".into(), scope.clone()).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        fs::write(&path, [0xff]).unwrap();
        assert!(read_file_scoped(path, scope, None).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn scoped_operations_refuse_file_and_directory_symlink_escapes() {
        use std::os::unix::fs::symlink;
        let root = scratch("symlink-scope");
        let workspace = root.join("workspace");
        let outside = root.join("outside");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "private").unwrap();
        symlink(outside.join("secret.txt"), workspace.join("file-link")).unwrap();
        symlink(&outside, workspace.join("dir-link")).unwrap();
        let scope = workspace.to_string_lossy().to_string();
        for relative in ["file-link", "dir-link/secret.txt"] {
            assert!(read_file_scoped(
                workspace.join(relative).to_string_lossy().to_string(),
                scope.clone(),
                None
            )
            .unwrap_err()
            .contains("outside"));
        }
        assert!(super::read_dir_scoped(
            workspace.join("dir-link").to_string_lossy().to_string(),
            scope.clone()
        )
        .is_err());
        assert!(write_new_file_scoped(
            workspace
                .join("dir-link/new.txt")
                .to_string_lossy()
                .to_string(),
            "new".into(),
            scope
        )
        .is_err());
        assert!(!outside.join("new.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copies_a_directory_tree_without_overwriting() {
        let root = scratch("copy-tree");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("note.md"), "hello").unwrap();
        fs::write(source.join("nested").join("todo.txt"), "ship it").unwrap();

        copy_path(
            source.to_string_lossy().to_string(),
            destination.to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(
            fs::read_to_string(destination.join("note.md")).unwrap(),
            "hello"
        );
        assert_eq!(
            fs::read_to_string(destination.join("nested").join("todo.txt")).unwrap(),
            "ship it"
        );
        assert!(copy_path(
            source.to_string_lossy().to_string(),
            destination.to_string_lossy().to_string(),
        )
        .unwrap_err()
        .contains("already exists"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_to_copy_a_directory_into_itself() {
        let root = scratch("copy-self");
        let source = root.join("source");
        fs::create_dir_all(&source).unwrap();
        let destination = source.join("source");

        let error = copy_path(
            source.to_string_lossy().to_string(),
            destination.to_string_lossy().to_string(),
        )
        .unwrap_err();

        assert_eq!(error, "cannot copy a folder into itself");
        assert!(!destination.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn path_validation_allows_double_dot_names_but_not_traversal() {
        assert!(super::validate_path("/tmp/project..backup/file").is_ok());
        assert!(super::validate_path("/tmp/project/../secret").is_err());
        assert!(super::validate_path("relative/file").is_err());
        assert!(super::validate_path("/tmp/null\0name").is_err());
    }

    #[test]
    fn creates_never_replace_existing_files_or_merge_directories() {
        let root = scratch("exclusive-create");
        fs::create_dir(&root).unwrap();
        let file = root.join("existing..txt");
        fs::write(&file, "keep me").unwrap();
        assert!(super::create_file(file.to_string_lossy().into()).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "keep me");
        assert!(super::create_dir(root.to_string_lossy().into()).is_err());
        super::create_file(root.join("new.txt").to_string_lossy().into()).unwrap();
        super::create_dir(root.join("new-dir").to_string_lossy().into()).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    #[test]
    fn concurrent_renames_have_exactly_one_winner_and_preserve_loser() {
        let root = scratch("exclusive-rename");
        fs::create_dir(&root).unwrap();
        let first = root.join("first");
        let second = root.join("second");
        let destination = root.join("destination");
        fs::write(&first, "first").unwrap();
        fs::write(&second, "second").unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let handles = [&first, &second].map(|source| {
            let source = source.clone();
            let destination = destination.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                super::rename_without_replace(&source, &destination)
            })
        });
        barrier.wait();
        let successes = handles
            .into_iter()
            .filter_map(|handle| handle.join().unwrap().ok())
            .count();
        assert_eq!(successes, 1);
        assert_eq!(first.exists() as u8 + second.exists() as u8, 1);
        let winner = fs::read_to_string(&destination).unwrap();
        let loser = fs::read_to_string(if first.exists() { &first } else { &second }).unwrap();
        assert_ne!(winner, loser);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn broken_symlink_destinations_are_never_replaced() {
        use std::os::unix::fs::symlink;
        let root = scratch("broken-link");
        fs::create_dir(&root).unwrap();
        let source = root.join("source");
        let destination = root.join("destination");
        let absent = root.join("absent");
        fs::write(&source, "source").unwrap();
        symlink(&absent, &destination).unwrap();
        assert!(super::create_file(destination.to_string_lossy().into()).is_err());
        assert!(super::rename_path(
            source.to_string_lossy().into(),
            destination.to_string_lossy().into()
        )
        .is_err());
        assert!(copy_path(
            source.to_string_lossy().into(),
            destination.to_string_lossy().into()
        )
        .is_err());
        assert_eq!(fs::read_link(&destination).unwrap(), absent);
        assert_eq!(fs::read_to_string(&source).unwrap(), "source");
        assert!(!absent.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn copy_refuses_self_copy_through_a_parent_symlink() {
        use std::os::unix::fs::symlink;
        let root = scratch("alias-copy");
        let source = root.join("source");
        let alias = root.join("alias");
        fs::create_dir_all(&source).unwrap();
        symlink(&source, &alias).unwrap();
        assert!(copy_path(
            source.to_string_lossy().into(),
            alias.join("child").to_string_lossy().into()
        )
        .is_err());
        assert!(!source.join("child").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_destination_created_after_preflight_is_never_cleaned_up() {
        let root = scratch("copy-collision");
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("source.txt"), "source").unwrap();
        // Simulate another writer winning after copy_path's destination check.
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("other-writer.txt"), "keep me").unwrap();
        let error = super::copy_preserving_destination(&source, &destination).unwrap_err();
        assert!(error.contains("no destination was deleted"));
        assert_eq!(
            fs::read_to_string(destination.join("other-writer.txt")).unwrap(),
            "keep me"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn listing_preserves_link_names_and_refuses_lossy_names() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        use std::os::unix::fs::symlink;
        let root = scratch("listing");
        fs::create_dir(&root).unwrap();
        let link = root.join("a link -> target\nname");
        symlink(root.join("missing"), &link).unwrap();
        let entries = super::read_dir_entries(&root).unwrap();
        assert_eq!(entries[0].name, "a link -> target\nname");
        assert!(entries[0].is_symlink);
        // APFS does not permit non-UTF-8 filenames, so exercise conversion
        // directly rather than depending on the temporary filesystem format.
        assert!(super::exact_file_name(OsString::from_vec(vec![0xff]))
            .unwrap_err()
            .contains("non-UTF-8"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn trash_refuses_root_and_home_without_starting_any_process() {
        assert!(super::trash_command("/").is_err());
        assert!(super::trash_command(&super::home_dir()).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn trash_passes_paths_as_arguments_never_script_source() {
        let path = "/tmp/a 'quoted' file; $(touch nope)\n.txt";
        let command = super::trash_command(path).unwrap();
        assert_eq!(command.get_program(), "/usr/bin/osascript");
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(args.last().unwrap(), &path);
        assert_eq!(args[3], super::TRASH_SCRIPT);
        assert!(!super::TRASH_SCRIPT.contains(path));
        assert!(super::TRASH_SCRIPT.contains("trashItemAtURL"));
    }
}
