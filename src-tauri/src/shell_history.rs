//! Reads the user's shell history file (zsh / bash) for the Ctrl+R picker:
//! most-recent-first, de-duplicated, with zsh's extended `: <ts>:<dur>;<cmd>`
//! format and `\`-continued multi-line commands handled.

use std::collections::HashSet;
use std::env;
use std::path::PathBuf;

#[derive(serde::Serialize)]
pub struct HistoryEntry {
    command: String,
    timestamp: Option<u64>,
}

fn resolve_home() -> Option<PathBuf> {
    dirs::home_dir()
}

fn resolve_histfile(home_dir: Option<&str>) -> Option<PathBuf> {
    if let Ok(p) = env::var("HISTFILE") {
        let pb = PathBuf::from(p);
        if pb.is_absolute() && pb.exists() {
            return Some(pb);
        }
    }
    let home = home_dir
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .or_else(resolve_home)?;
    for name in [".zsh_history", ".bash_history"] {
        let p = home.join(name);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

#[tauri::command]
pub fn pty_shell_history(
    home_dir: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<HistoryEntry>, String> {
    let histfile = resolve_histfile(home_dir.as_deref()).ok_or("no shell history file found")?;
    let bytes = std::fs::read(&histfile).map_err(|e| e.to_string())?;
    let data = String::from_utf8_lossy(&bytes);

    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    let mut buf = String::new();

    for raw_line in data.lines().rev() {
        let line = raw_line.trim_end();
        if line.ends_with('\\') {
            buf.push_str(&line[..line.len() - 1]);
            buf.push('\n');
            continue;
        }
        let full_line = if buf.is_empty() {
            line.to_string()
        } else {
            buf.push_str(line);
            let result = buf.clone();
            buf.clear();
            result
        };

        let (timestamp, command) = parse_zsh_history_line(&full_line);
        let trimmed = command.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("__husk") || trimmed.starts_with("builtin ") {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            entries.push(HistoryEntry {
                command: trimmed.to_string(),
                timestamp,
            });
            if let Some(l) = limit {
                if entries.len() >= l {
                    break;
                }
            }
        }
    }

    Ok(entries)
}

fn parse_zsh_history_line(line: &str) -> (Option<u64>, String) {
    if let Some(rest) = line.strip_prefix(": ") {
        if let Some(semi) = rest.find(';') {
            let meta = &rest[..semi];
            let cmd = &rest[semi + 1..];
            let ts_part = meta.split(':').next().unwrap_or(meta);
            if let Ok(ts) = ts_part.trim().parse::<u64>() {
                return (Some(ts), cmd.to_string());
            }
            return (None, cmd.to_string());
        }
    }
    (None, line.to_string())
}
