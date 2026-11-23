//! Reads saved zsh / bash history for the Ctrl+R picker. Logical commands are
//! reconstructed before newest-first ordering and deduplication, so multiline
//! entries remain intact and a command's latest occurrence wins.

use std::collections::HashSet;
use std::env;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

const MAX_HISTORY_ENTRIES: usize = 10_000;
const MAX_HISTORY_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Copy, PartialEq)]
enum HistoryFormat {
    Zsh,
    Bash,
    Auto,
}

#[derive(Debug, PartialEq, serde::Serialize)]
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
        if pb.is_absolute() && pb.is_file() {
            return Some(pb);
        }
    }
    let home = home_dir
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(resolve_home)?;
    for name in [".zsh_history", ".bash_history"] {
        let p = home.join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

#[tauri::command]
pub async fn pty_shell_history(
    home_dir: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<HistoryEntry>, String> {
    let limit = limit
        .unwrap_or(MAX_HISTORY_ENTRIES)
        .min(MAX_HISTORY_ENTRIES);
    if limit == 0 {
        return Ok(Vec::new());
    }
    // Opening a large history file must not block Tauri's event-loop thread.
    tauri::async_runtime::spawn_blocking(move || {
        let histfile =
            resolve_histfile(home_dir.as_deref()).ok_or("no shell history file found")?;
        let mut file = std::fs::File::open(&histfile).map_err(|e| e.to_string())?;
        let (bytes, truncated) =
            read_history_tail(&mut file, MAX_HISTORY_BYTES).map_err(|e| e.to_string())?;
        let data = String::from_utf8_lossy(&bytes);
        let format = match histfile.file_name().and_then(|name| name.to_str()) {
            Some(".zsh_history") => HistoryFormat::Zsh,
            Some(".bash_history") => HistoryFormat::Bash,
            _ => HistoryFormat::Auto,
        };
        Ok(parse_history_format(&data, truncated, limit, format))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Bound both I/O and allocation even if an unusually large file keeps growing.
fn read_history_tail<R: Read + Seek>(
    reader: &mut R,
    max_bytes: u64,
) -> std::io::Result<(Vec<u8>, bool)> {
    let len = reader.seek(SeekFrom::End(0))?;
    let start = len.saturating_sub(max_bytes);
    reader.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::with_capacity(len.min(max_bytes) as usize);
    reader.take(max_bytes).read_to_end(&mut bytes)?;
    Ok((bytes, start > 0))
}

#[cfg(test)]
fn parse_history(data: &str, truncated: bool, limit: usize) -> Vec<HistoryEntry> {
    parse_history_format(data, truncated, limit, HistoryFormat::Auto)
}

fn parse_history_format(
    data: &str,
    truncated: bool,
    limit: usize,
    format: HistoryFormat,
) -> Vec<HistoryEntry> {
    let limit = limit.min(MAX_HISTORY_ENTRIES);
    if limit == 0 {
        return Vec::new();
    }

    // Bash timestamp lines delimit complete records, including literal multiline
    // commands written with `lithist`. Zsh timestamps live on the command line.
    let format = if format == HistoryFormat::Auto {
        data.lines()
            .find_map(|line| {
                if parse_zsh_header(line).is_some() {
                    Some(HistoryFormat::Zsh)
                } else if parse_bash_timestamp(line).is_some() {
                    Some(HistoryFormat::Bash)
                } else {
                    None
                }
            })
            .unwrap_or(HistoryFormat::Auto)
    } else {
        format
    };
    let bash_timestamps = format == HistoryFormat::Bash
        && data
            .lines()
            .any(|line| parse_bash_timestamp(line).is_some());
    let data = if truncated {
        skip_partial_record(data, bash_timestamps)
    } else {
        data
    };
    let mut entries = if bash_timestamps {
        parse_bash_records(data)
    } else {
        parse_line_records(data, format == HistoryFormat::Zsh)
    };
    entries.reverse();
    // Shared shell history can append an older session's entries after newer
    // ones. Use actual timestamps when every record has them. Mixed legacy
    // files have no reliable dates for their plain entries; retain file order
    // rather than inventing timestamps or relegating those entries to the end.
    if entries.iter().all(|entry| entry.timestamp.is_some()) {
        entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    }
    let mut seen = HashSet::new();
    entries
        .into_iter()
        .filter_map(|mut entry| {
            let trimmed = entry.command.trim();
            if trimmed.is_empty() || trimmed.starts_with("__husk") {
                return None;
            }
            entry.command = trimmed.to_string();
            seen.insert(entry.command.clone()).then_some(entry)
        })
        .take(limit)
        .collect()
}

/// The tail may start in the middle of a line or multiline command. Discard the
/// entire fragment instead of presenting a suffix as an independently runnable
/// command. For timestamped Bash, only a following timestamp is a safe boundary.
fn skip_partial_record(data: &str, bash_timestamps: bool) -> &str {
    let mut remaining = data;
    loop {
        let Some(newline) = remaining.find('\n') else {
            return "";
        };
        let line = remaining[..newline].trim_end_matches('\r');
        remaining = &remaining[newline + 1..];
        if bash_timestamps {
            if remaining
                .lines()
                .next()
                .is_some_and(|line| parse_bash_timestamp(line).is_some())
            {
                return remaining;
            }
        } else if !line.ends_with('\\') {
            return remaining;
        }
    }
}

fn parse_line_records(data: &str, zsh: bool) -> Vec<HistoryEntry> {
    let mut entries = Vec::new();
    let mut command = String::new();
    let mut timestamp = None;
    let mut continued = false;
    for raw_line in data.lines() {
        let line = if continued {
            raw_line
        } else if let Some((ts, text)) = zsh.then(|| parse_zsh_header(raw_line)).flatten() {
            timestamp = Some(ts);
            text
        } else {
            timestamp = None;
            raw_line
        };
        if let Some(part) = line.strip_suffix('\\') {
            // Zsh adds a serialization backslash before stored newlines. In
            // Bash/plain history the backslash belongs to the command itself.
            command.push_str(if zsh { part } else { line });
            command.push('\n');
            continued = true;
        } else {
            command.push_str(line);
            entries.push(HistoryEntry {
                command: std::mem::take(&mut command),
                timestamp,
            });
            continued = false;
        }
    }
    // A final continuation has not finished being written. Do not expose an
    // incomplete command that might be unsafe when staged and run later.
    entries
}

fn parse_bash_records(data: &str) -> Vec<HistoryEntry> {
    let mut entries = Vec::new();
    let mut current: Option<HistoryEntry> = None;
    for line in data.lines() {
        if let Some(timestamp) = parse_bash_timestamp(line) {
            if let Some(entry) = current.take() {
                entries.push(entry);
            }
            current = Some(HistoryEntry {
                command: String::new(),
                timestamp: Some(timestamp),
            });
        } else if let Some(entry) = current.as_mut() {
            if !entry.command.is_empty() {
                entry.command.push('\n');
            }
            entry.command.push_str(line);
        } else {
            // Commands from before timestamped Bash history was enabled.
            entries.push(HistoryEntry {
                command: line.to_string(),
                timestamp: None,
            });
        }
    }
    if let Some(entry) = current {
        entries.push(entry);
    }
    entries
}

fn parse_bash_timestamp(line: &str) -> Option<u64> {
    let value = line.strip_prefix('#')?;
    (!value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| value.parse().ok())
        .flatten()
}

fn parse_zsh_header(line: &str) -> Option<(u64, &str)> {
    let rest = line.strip_prefix(": ")?;
    let (metadata, command) = rest.split_once(';')?;
    let (timestamp, duration) = metadata.split_once(':')?;
    // A malformed prefix can be a legitimate shell command (`:` is a builtin).
    // Only remove metadata after validating the complete extended-history form.
    let timestamp = timestamp.trim().parse().ok()?;
    duration.trim().parse::<u64>().ok()?;
    Some((timestamp, command))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn commands(entries: &[HistoryEntry]) -> Vec<&str> {
        entries.iter().map(|entry| entry.command.as_str()).collect()
    }

    #[test]
    fn plain_history_is_newest_first_and_deduplicates_latest_occurrence() {
        let entries = parse_history("pwd\ngit status\npwd\nls\n", false, 10);
        assert_eq!(commands(&entries), ["ls", "pwd", "git status"]);
        assert!(entries.iter().all(|entry| entry.timestamp.is_none()));
    }

    #[test]
    fn extended_history_uses_timestamps_before_deduplication() {
        let entries = parse_history(
            ": 300:0;git status\n: 100:0;pwd\n: 200:0;git status\n: 250:0;ls\n",
            false,
            10,
        );
        assert_eq!(commands(&entries), ["git status", "ls", "pwd"]);
        assert_eq!(entries[0].timestamp, Some(300));
    }

    #[test]
    fn equal_timestamps_preserve_latest_file_position() {
        let entries = parse_history(": 100:0;pwd\n: 100:0;ls\n", false, 10);
        assert_eq!(commands(&entries), ["ls", "pwd"]);
    }

    #[test]
    fn multiline_zsh_records_are_reconstructed_before_reversing() {
        let entries = parse_history(
            ": 100:0;echo 'first\\\nsecond\\\nthird'\n: 200:0;pwd\n",
            false,
            10,
        );
        assert_eq!(commands(&entries), ["pwd", "echo 'first\nsecond\nthird'"]);
        assert_eq!(entries[1].timestamp, Some(100));
    }

    #[test]
    fn multiline_continuation_does_not_parse_content_as_metadata() {
        let entries = parse_history(": 100:0;cat <<'EOF'\\\n: 200:0;literal\\\nEOF\n", false, 10);
        assert_eq!(commands(&entries), ["cat <<'EOF'\n: 200:0;literal\nEOF"]);
        assert_eq!(entries[0].timestamp, Some(100));
    }

    #[test]
    fn plain_bash_continuations_keep_the_shell_escape() {
        let entries =
            parse_history_format("echo one \\\n  two\npwd\n", false, 10, HistoryFormat::Bash);
        assert_eq!(commands(&entries), ["pwd", "echo one \\\n  two"]);
        let zsh = parse_history_format("echo 'one\\\ntwo'\n", false, 10, HistoryFormat::Zsh);
        assert_eq!(commands(&zsh), ["echo 'one\ntwo'"]);
    }

    #[test]
    fn bash_heredoc_content_is_not_mistaken_for_zsh_metadata() {
        let entries = parse_history_format(
            "#100\ncat <<'EOF'\n: 200:0;literal\nEOF\n#300\npwd\n",
            false,
            10,
            HistoryFormat::Bash,
        );
        assert_eq!(
            commands(&entries),
            ["pwd", "cat <<'EOF'\n: 200:0;literal\nEOF"]
        );
        assert_eq!(entries[1].timestamp, Some(100));
    }

    #[test]
    fn bash_timestamps_are_not_commands_and_multiline_records_stay_together() {
        let entries = parse_history(
            "#100\nfor f in *; do\n  echo \"$f\"\ndone\n#200\ngit status\n",
            false,
            10,
        );
        assert_eq!(
            commands(&entries),
            ["git status", "for f in *; do\n  echo \"$f\"\ndone"]
        );
        assert_eq!(entries[1].timestamp, Some(100));
    }

    #[test]
    fn mixed_history_keeps_file_order_without_fabricating_dates() {
        let entries = parse_history(": 100:0;old\nnew untimed\n", false, 10);
        assert_eq!(commands(&entries), ["new untimed", "old"]);
        assert_eq!(entries[0].timestamp, None);
    }

    #[test]
    fn user_builtin_commands_and_invalid_metadata_are_preserved() {
        let entries = parse_history(
            "builtin cd /tmp\n: note;echo useful\n__husk_internal\n",
            false,
            10,
        );
        assert_eq!(
            commands(&entries),
            [": note;echo useful", "builtin cd /tmp"]
        );
    }

    #[test]
    fn limits_count_unique_nonempty_commands_and_zero_is_empty() {
        let data = "pwd\nls\nls\n\n__husk_hook\n";
        assert_eq!(commands(&parse_history(data, false, 1)), ["ls"]);
        assert!(parse_history(data, false, 0).is_empty());
        assert!(parse_history("#100\n#200\n", false, 10).is_empty());
        assert!(parse_history("\n  \n", false, 10).is_empty());
    }

    #[test]
    fn truncated_zsh_tail_discards_entire_partial_multiline_record() {
        let entries = parse_history("first\\\nsecond\\\nthird\n: 200:0;pwd\n", true, 10);
        assert_eq!(commands(&entries), ["pwd"]);
    }

    #[test]
    fn truncated_bash_tail_starts_only_at_a_complete_timestamped_record() {
        let entries = parse_history("echo partial\ndone\n#200\npwd\n", true, 10);
        assert_eq!(commands(&entries), ["pwd"]);
        assert_eq!(entries[0].timestamp, Some(200));
    }

    #[test]
    fn incomplete_multiline_tail_is_not_a_standalone_command() {
        assert_eq!(
            commands(&parse_history("pwd\necho partial\\\n", false, 10)),
            ["pwd"]
        );
        assert!(parse_history("partial without newline", true, 10).is_empty());
    }

    #[test]
    fn reads_only_bounded_tail_and_handles_small_files() {
        let mut cursor = std::io::Cursor::new(b"old\nnew\n");
        let (bytes, truncated) = read_history_tail(&mut cursor, 5).unwrap();
        assert_eq!(bytes, b"\nnew\n");
        assert!(truncated);
        assert_eq!(
            commands(&parse_history(
                std::str::from_utf8(&bytes).unwrap(),
                truncated,
                10
            )),
            ["new"]
        );

        let (bytes, truncated) = read_history_tail(&mut cursor, 100).unwrap();
        assert_eq!(bytes, b"old\nnew\n");
        assert!(!truncated);
    }

    #[test]
    fn result_count_is_capped_even_when_caller_requests_more() {
        let data = (0..MAX_HISTORY_ENTRIES + 2)
            .map(|i| format!("echo {i}\n"))
            .collect::<String>();
        let entries = parse_history(&data, false, usize::MAX);
        assert_eq!(entries.len(), MAX_HISTORY_ENTRIES);
        assert_eq!(
            entries[0].command,
            format!("echo {}", MAX_HISTORY_ENTRIES + 1)
        );
    }
}
