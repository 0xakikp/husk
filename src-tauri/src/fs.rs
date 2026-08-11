//! Minimal filesystem commands for the file explorer and editor.

use base64::Engine;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// Validate that a path is safe: no parent directory traversal ("..") and must be absolute.
fn validate_path(path: &str) -> Result<&str, String> {
    if path.contains("..") {
        return Err("Path traversal not allowed".to_string());
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

fn read_dir_entries(path: &Path) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| {
            let p = e.path();
            DirEntry {
                name: e.file_name().to_string_lossy().to_string(),
                path: p.to_string_lossy().to_string(),
                is_dir: p.is_dir(),
            }
        })
        .collect();
    // Directories first, then case-insensitive by name.
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    validate_path(&path)?;
    read_dir_entries(Path::new(&path))
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
pub fn read_file_scoped(path: String, root: String) -> Result<String, String> {
    let path = scoped_existing_path(&path, &root)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
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
    if path.exists() {
        return Err(format!("already exists: {}", path.to_string_lossy()));
    }
    fs::create_dir_all(path).map_err(|e| e.to_string())
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
    let p = Path::new(&path);
    if p.exists() {
        return Err(format!("already exists: {path}"));
    }
    fs::write(p, "").map_err(|e| e.to_string())
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

/// Create a directory (with parents). Fails if it already exists.
#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    validate_path(&path)?;
    let p = Path::new(&path);
    if p.exists() {
        return Err(format!("already exists: {path}"));
    }
    fs::create_dir_all(p).map_err(|e| e.to_string())
}

/// Rename or move a path. Refuses to overwrite an existing target.
#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    validate_path(&from)?;
    validate_path(&to)?;
    let from_p = Path::new(&from);
    let to_p = Path::new(&to);
    if !from_p.exists() {
        return Err(format!("not found: {from}"));
    }
    if to_p.exists() {
        return Err(format!("already exists: {to}"));
    }
    fs::rename(from_p, to_p).map_err(|e| e.to_string())
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
