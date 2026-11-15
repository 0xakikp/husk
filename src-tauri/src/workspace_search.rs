//! Bounded local-folder search. No shell, installed CLI, background disk index,
//! or implicit remote/whole-computer scope. Ignore syntax is handled by the
//! same `ignore` crate used by ripgrep; file names travel as structured JSON.

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    Files,
    Contents,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRequest {
    pub id: String,
    pub root: String,
    pub query: String,
    pub mode: SearchMode,
    #[serde(default)]
    pub include_hidden: bool,
    #[serde(default)]
    pub include_ignored: bool,
    pub max_results: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    path: String,
    rel: String,
    name: String,
    line: Option<usize>,
    column: Option<usize>,
    text: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    results: Vec<SearchResult>,
    truncated: bool,
    timed_out: bool,
    scanned_files: usize,
    skipped_files: usize,
    errors: usize,
    reason: Option<String>,
}

struct Job {
    cancelled: Arc<AtomicBool>,
    started: Instant,
    active: bool,
}
static JOBS: OnceLock<Mutex<HashMap<String, Job>>> = OnceLock::new();
fn jobs() -> &'static Mutex<HashMap<String, Job>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Cancellation may arrive before the search IPC is scheduled. Keep a short,
/// bounded tombstone so that such a request never starts a late orphan worker.
#[tauri::command]
pub fn workspace_search_cancel(id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("Invalid search identifier".into());
    }
    let mut registry = jobs().lock().map_err(|_| "Search registry unavailable")?;
    registry.retain(|_, job| job.active || job.started.elapsed() < Duration::from_secs(30));
    if let Some(job) = registry.get(&id) {
        job.cancelled.store(true, Ordering::Relaxed);
    } else if registry.len() < 128 {
        registry.insert(
            id,
            Job {
                cancelled: Arc::new(AtomicBool::new(true)),
                started: Instant::now(),
                active: false,
            },
        );
    }
    Ok(())
}

struct JobGuard(String);
impl Drop for JobGuard {
    fn drop(&mut self) {
        if let Ok(mut registry) = jobs().lock() {
            registry.remove(&self.0);
        }
    }
}

#[tauri::command]
pub async fn workspace_search(request: SearchRequest) -> Result<SearchOutcome, String> {
    if !valid_id(&request.id) {
        return Err("Invalid search identifier".into());
    }
    let cancelled = {
        let mut registry = jobs().lock().map_err(|_| "Search registry unavailable")?;
        registry.retain(|_, job| job.active || job.started.elapsed() < Duration::from_secs(30));
        if let Some(job) = registry.get(&request.id) {
            return Err(if job.cancelled.load(Ordering::Relaxed) {
                "Workspace search was cancelled."
            } else {
                "Search identifier is already active."
            }
            .into());
        }
        if registry.values().filter(|job| job.active).count() >= 4 {
            return Err("Search is busy. Wait a moment and try again.".into());
        }
        let flag = Arc::new(AtomicBool::new(false));
        registry.insert(
            request.id.clone(),
            Job {
                cancelled: flag.clone(),
                started: Instant::now(),
                active: true,
            },
        );
        flag
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = JobGuard(request.id.clone());
        search(&request, &cancelled, Limits::default())
    })
    .await
    .map_err(|e| format!("Search worker failed: {e}"))?
}

#[derive(Clone, Copy)]
struct Limits {
    entries: usize,
    directories: usize,
    bytes: usize,
    file_bytes: usize,
    depth: usize,
    time: Duration,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            entries: 100_000,
            directories: 10_000,
            bytes: 32 * 1024 * 1024,
            file_bytes: 2 * 1024 * 1024,
            depth: 32,
            time: Duration::from_secs(5),
        }
    }
}

struct Scanner<'a> {
    request: &'a SearchRequest,
    root: PathBuf,
    output_root: PathBuf,
    query: String,
    #[cfg(unix)]
    root_handle: File,
    cancelled: &'a AtomicBool,
    started: Instant,
    limits: Limits,
    entries: usize,
    directories: usize,
    bytes: usize,
    ignore_bytes: usize,
    max_results: usize,
    outcome: SearchOutcome,
}

fn search(
    request: &SearchRequest,
    cancelled: &AtomicBool,
    limits: Limits,
) -> Result<SearchOutcome, String> {
    let input = Path::new(&request.root);
    if !input.is_absolute()
        || input
            .components()
            .any(|c| matches!(c, Component::ParentDir))
    {
        return Err("Choose an absolute folder path without parent traversal.".into());
    }
    let root = fs::canonicalize(input).map_err(|e| format!("Search folder is unavailable: {e}"))?;
    if !root.is_dir() {
        return Err("Search scope must be a folder.".into());
    }
    if root.parent().is_none() {
        return Err("Select a project folder, not the filesystem root.".into());
    }
    if root.components().any(|part| matches!(part, Component::Normal(name) if name.to_str().is_some_and(|name| name.eq_ignore_ascii_case(".git")))) {
        return Err("Git metadata is excluded from workspace search. Select the project folder.".into());
    }
    if request.query.len() > 4096 || request.query.contains('\0') {
        return Err("Search query is too long or contains an invalid character.".into());
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err("Workspace search was cancelled.".into());
    }
    // Open now so an inaccessible root is an error, not a false empty result.
    fs::read_dir(&root).map_err(|e| format!("Cannot read search folder: {e}"))?;
    let mut scanner = Scanner {
        request,
        root: root.clone(),
        output_root: input.to_path_buf(),
        query: request.query.to_lowercase(),
        #[cfg(unix)]
        root_handle: {
            use std::os::unix::fs::OpenOptionsExt;
            OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(&root)
                .map_err(|e| format!("Cannot open search scope: {e}"))?
        },
        cancelled,
        started: Instant::now(),
        limits,
        entries: 0,
        directories: 0,
        bytes: 0,
        ignore_bytes: 0,
        max_results: request.max_results.unwrap_or(200).clamp(1, 500),
        outcome: SearchOutcome::default(),
    };
    if request.mode == SearchMode::Contents && request.query.is_empty() {
        return Ok(scanner.outcome);
    }
    let mut git_ignores = Vec::new();
    let mut ignores = Vec::new();
    // In linked worktrees `.git` is a regular pointer file, not a directory.
    // Its absence (or that shape) is normal, not an unreadable search item.
    if !request.include_ignored
        && fs::symlink_metadata(root.join(".git"))
            .is_ok_and(|metadata| metadata.file_type().is_dir())
    {
        if let Some(ignore) = scanner.load_ignore(&root.join(".git/info/exclude"), &root) {
            git_ignores.push(ignore);
        }
    }
    scanner.walk(&root, 0, &mut git_ignores, &mut ignores)?;
    scanner.outcome.results.sort_by(|a, b| {
        a.rel
            .to_lowercase()
            .cmp(&b.rel.to_lowercase())
            .then(a.rel.cmp(&b.rel))
            .then(a.line.cmp(&b.line))
    });
    Ok(scanner.outcome)
}

impl Scanner<'_> {
    fn stop(&mut self) -> Result<bool, String> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err("Workspace search was cancelled.".into());
        }
        if self.outcome.truncated {
            return Ok(true);
        }
        let reason = if self.started.elapsed() >= self.limits.time {
            self.outcome.timed_out = true;
            Some("Search reached its time limit. Narrow the query or choose a smaller folder.")
        } else {
            None
        };
        if let Some(reason) = reason {
            self.outcome.truncated = true;
            self.outcome.reason = Some(reason.into());
            return Ok(true);
        }
        Ok(false)
    }

    /// Read only regular, in-scope files. No directory/file symlinks are
    /// followed; canonical containment also rejects a changed parent link.
    fn open_regular(&self, path: &Path) -> std::io::Result<File> {
        let metadata = fs::symlink_metadata(path)?;
        if !metadata.file_type().is_file() {
            return Err(std::io::Error::other("Not a regular file"));
        }
        let resolved = fs::canonicalize(path)?;
        if !resolved.starts_with(&self.root) {
            return Err(std::io::Error::other("Path left the search scope"));
        }
        #[cfg(unix)]
        {
            // Walk every path component relative to an already-open root fd.
            // O_NOFOLLOW on each component prevents parent-directory swaps
            // from turning a checked in-scope path into an outside file read.
            return open_at_root(
                &self.root_handle,
                resolved
                    .strip_prefix(&self.root)
                    .map_err(|_| std::io::Error::other("Path left the search scope"))?,
            );
        }
        #[cfg(not(unix))]
        {
            let file = OpenOptions::new().read(true).open(resolved)?;
            if !file.metadata()?.is_file() {
                return Err(std::io::Error::other("Not a regular file"));
            }
            Ok(file)
        }
    }

    fn load_ignore(&mut self, path: &Path, directory: &Path) -> Option<Gitignore> {
        match fs::symlink_metadata(path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
            Err(_) => {
                self.outcome.errors += 1;
                return None;
            }
            Ok(metadata)
                if !metadata.file_type().is_file()
                    || metadata.len() > 65_536
                    || self.ignore_bytes >= 1024 * 1024 =>
            {
                self.outcome.errors += 1;
                return None;
            }
            _ => {}
        }
        let read = self.open_regular(path).and_then(|file| {
            let mut text = String::new();
            file.take(65_537).read_to_string(&mut text)?;
            Ok(text)
        });
        let text = match read {
            Ok(text) if text.len() <= 65_536 => text,
            _ => {
                self.outcome.errors += 1;
                return None;
            }
        };
        self.ignore_bytes += text.len();
        let mut builder = GitignoreBuilder::new(directory);
        for line in text.lines() {
            if builder.add_line(Some(path.to_path_buf()), line).is_err() {
                self.outcome.errors += 1;
            }
        }
        match builder.build() {
            Ok(matcher) => Some(matcher),
            Err(_) => {
                self.outcome.errors += 1;
                None
            }
        }
    }

    fn walk(
        &mut self,
        directory: &Path,
        depth: usize,
        git_ignores: &mut Vec<Gitignore>,
        ignores: &mut Vec<Gitignore>,
    ) -> Result<(), String> {
        if self.stop()? {
            return Ok(());
        }
        if depth > self.limits.depth {
            self.outcome.skipped_files += 1;
            self.outcome
                .reason
                .get_or_insert_with(|| "Some folders exceeded the search depth limit.".into());
            return Ok(());
        }
        let resolved = match fs::canonicalize(directory) {
            Ok(path) if path.starts_with(&self.root) => path,
            _ => {
                self.outcome.errors += 1;
                return Ok(());
            }
        };
        self.directories += 1;
        let git_count = git_ignores.len();
        let ignore_count = ignores.len();
        if !self.request.include_ignored {
            if let Some(matcher) = self.load_ignore(&resolved.join(".gitignore"), &resolved) {
                git_ignores.push(matcher);
            }
            if let Some(matcher) = self.load_ignore(&resolved.join(".ignore"), &resolved) {
                ignores.push(matcher);
            }
        }
        let entries = match fs::read_dir(&resolved) {
            Ok(entries) => entries,
            Err(_) => {
                self.outcome.errors += 1;
                git_ignores.truncate(git_count);
                ignores.truncate(ignore_count);
                return Ok(());
            }
        };
        for entry in entries {
            if self.stop()? {
                break;
            }
            if self.entries >= self.limits.entries || self.directories >= self.limits.directories {
                self.outcome.truncated = true;
                self.outcome.reason = Some(
                    "Search reached its scan limit. Choose a smaller folder for complete results."
                        .into(),
                );
                break;
            }
            self.entries += 1;
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    self.outcome.errors += 1;
                    continue;
                }
            };
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                self.outcome.skipped_files += 1;
                continue;
            };
            if name.eq_ignore_ascii_case(".git")
                || (!self.request.include_hidden && name.starts_with('.'))
            {
                continue;
            }
            let path = entry.path();
            let kind = match entry.file_type() {
                Ok(kind) => kind,
                Err(_) => {
                    self.outcome.errors += 1;
                    continue;
                }
            };
            if !self.request.include_ignored
                && is_ignored(&path, kind.is_dir(), git_ignores, ignores)
            {
                continue;
            }
            if kind.is_symlink() || (!kind.is_dir() && !kind.is_file()) {
                self.outcome.skipped_files += 1;
                continue;
            }
            if kind.is_dir() {
                self.walk(&path, depth + 1, git_ignores, ignores)?;
                continue;
            }
            self.outcome.scanned_files += 1;
            let Ok(relative) = path.strip_prefix(&self.root) else {
                self.outcome.errors += 1;
                continue;
            };
            let Some(rel) = relative.to_str() else {
                self.outcome.skipped_files += 1;
                continue;
            };
            let rel = rel.replace(std::path::MAIN_SEPARATOR, "/");
            if self.request.mode == SearchMode::Files {
                if filename_matches(&rel.to_lowercase(), &self.query) {
                    self.add_match(&rel, name, None, None, None);
                }
            } else {
                self.search_contents(&path, &rel, name)?;
            }
        }
        git_ignores.truncate(git_count);
        ignores.truncate(ignore_count);
        Ok(())
    }

    fn add_match(
        &mut self,
        rel: &str,
        name: &str,
        line: Option<usize>,
        column: Option<usize>,
        text: Option<String>,
    ) {
        if self.outcome.results.len() >= self.max_results {
            self.outcome.truncated = true;
            self.outcome.reason = Some(format!(
                "More than {} matches. Narrow your search to see the rest.",
                self.max_results
            ));
            return;
        }
        self.outcome.results.push(SearchResult {
            path: self.output_root.join(rel).to_string_lossy().into_owned(),
            rel: rel.into(),
            name: name.into(),
            line,
            column,
            text,
        });
    }

    fn search_contents(&mut self, path: &Path, rel: &str, name: &str) -> Result<(), String> {
        let file = match self.open_regular(path) {
            Ok(file) => file,
            Err(_) => {
                self.outcome.errors += 1;
                return Ok(());
            }
        };
        let size = match file.metadata() {
            Ok(meta) => meta.len(),
            Err(_) => {
                self.outcome.errors += 1;
                return Ok(());
            }
        };
        if size > self.limits.file_bytes as u64 {
            self.outcome.skipped_files += 1;
            return Ok(());
        }
        if size > self.limits.bytes.saturating_sub(self.bytes) as u64 {
            self.outcome.truncated = true;
            self.outcome.reason = Some("Search reached its content-read limit. Choose a smaller folder for complete results.".into());
            return Ok(());
        }
        let mut bytes = Vec::new();
        if file
            .take(self.limits.file_bytes as u64 + 1)
            .read_to_end(&mut bytes)
            .is_err()
        {
            self.outcome.errors += 1;
            return Ok(());
        }
        self.bytes += bytes.len();
        if bytes.len() > self.limits.file_bytes || bytes.contains(&0) {
            self.outcome.skipped_files += 1;
            return Ok(());
        }
        let text = match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(_) => {
                self.outcome.skipped_files += 1;
                return Ok(());
            }
        };
        for (line_index, line) in text.lines().enumerate() {
            if self.stop()? {
                break;
            }
            if let Some(offset) = line.to_lowercase().find(&self.query) {
                // Map a lowercase byte offset back to the original UTF-16
                // column expected by editors (some case folds change length).
                let mut lower_bytes = 0;
                let mut column = 1;
                let mut original_offset = 0;
                for (byte_offset, character) in line.char_indices() {
                    let folded_bytes = character.to_lowercase().map(char::len_utf8).sum::<usize>();
                    if lower_bytes + folded_bytes > offset {
                        original_offset = byte_offset;
                        break;
                    }
                    lower_bytes += folded_bytes;
                    column += character.len_utf16();
                }
                // Keep the actual hit visible even in a long/minified line.
                // The displayed snippet may be shortened, never the path or
                // authoritative line/column used to open the result.
                let context_start = line[..original_offset]
                    .char_indices()
                    .rev()
                    .nth(80)
                    .map_or(0, |(offset, _)| offset);
                let snippet: String = line[context_start..].chars().take(600).collect();
                let snippet = if context_start > 0 {
                    format!("…{snippet}")
                } else {
                    snippet
                };
                self.add_match(rel, name, Some(line_index + 1), Some(column), Some(snippet));
            }
        }
        Ok(())
    }
}

fn filename_matches(path: &str, query: &str) -> bool {
    if path.contains(query) {
        return true;
    }
    let mut characters = query.chars();
    let mut next = characters.next();
    for character in path.chars() {
        if Some(character) == next {
            next = characters.next();
            if next.is_none() {
                return true;
            }
        }
    }
    next.is_none()
}

#[cfg(unix)]
fn open_at_root(root: &File, relative: &Path) -> std::io::Result<File> {
    use std::ffi::CString;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    let mut directory = root.try_clone()?;
    let mut components = relative.components().peekable();
    while let Some(component) = components.next() {
        let Component::Normal(name) = component else {
            return Err(std::io::Error::other("Invalid scoped path"));
        };
        let name =
            CString::new(name.as_bytes()).map_err(|_| std::io::Error::other("Invalid filename"))?;
        let final_component = components.peek().is_none();
        let flags = libc::O_RDONLY
            | libc::O_NOFOLLOW
            | libc::O_CLOEXEC
            | if final_component {
                libc::O_NONBLOCK
            } else {
                libc::O_DIRECTORY
            };
        // SAFETY: CString is NUL-terminated, directory owns a live fd, and
        // successful openat returns a new fd transferred to File exactly once.
        let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        let file = unsafe { File::from_raw_fd(fd) };
        if final_component {
            if !file.metadata()?.is_file() {
                return Err(std::io::Error::other("Not a regular file"));
            }
            return Ok(file);
        }
        directory = file;
    }
    Err(std::io::Error::other("Expected a file inside search scope"))
}

fn is_ignored(path: &Path, is_dir: bool, git_ignores: &[Gitignore], ignores: &[Gitignore]) -> bool {
    // `.ignore` takes precedence over `.gitignore`; within each kind, the
    // nearest directory and last matching rule win. Ignored parent directories
    // are pruned, preserving Git's negation semantics.
    for matcher in ignores.iter().rev().chain(git_ignores.iter().rev()) {
        let matched = matcher.matched(path, is_dir);
        if !matched.is_none() {
            return matched.is_ignore();
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static SEQUENCE: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "husk-search-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::SeqCst)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn file(&self, name: &str, text: &[u8]) {
            let path = self.0.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
        fn request(&self, query: &str, mode: SearchMode) -> SearchRequest {
            SearchRequest {
                id: "test".into(),
                root: self.0.to_str().unwrap().into(),
                query: query.into(),
                mode,
                include_hidden: false,
                include_ignored: false,
                max_results: Some(200),
            }
        }
        fn run(&self, query: &str, mode: SearchMode) -> SearchOutcome {
            search(
                &self.request(query, mode),
                &AtomicBool::new(false),
                Limits::default(),
            )
            .unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn finds_recursive_files_without_git_or_cli_and_preserves_names() {
        let f = Fixture::new();
        f.file("src/deep/ a:b\nfile.ts ", b"text");
        f.file("src/environment.ts", b"text");
        let result = f.run("FILE.TS", SearchMode::Files);
        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0].rel, "src/deep/ a:b\nfile.ts ");
        assert_eq!(f.run("environment", SearchMode::Files).results.len(), 1);
        assert_eq!(f.run("senvts", SearchMode::Files).results.len(), 1);
    }

    #[test]
    fn applies_nested_gitignores_negation_and_explicit_overrides() {
        let f = Fixture::new();
        f.file(".gitignore", b"*.log\n!keep.log\nbuild/\n");
        for name in [
            "ignore.log",
            "keep.log",
            "build/output.ts",
            ".hidden.ts",
            ".git/config",
            "src/child.log",
        ] {
            f.file(name, b"needle");
        }
        f.file("src/.gitignore", b"!child.log\n");
        let normal = f.run("", SearchMode::Files);
        assert_eq!(
            normal
                .results
                .iter()
                .map(|r| r.rel.as_str())
                .collect::<Vec<_>>(),
            vec!["keep.log", "src/child.log"]
        );
        let mut request = f.request("", SearchMode::Files);
        request.include_hidden = true;
        request.include_ignored = true;
        let expanded = search(&request, &AtomicBool::new(false), Limits::default()).unwrap();
        assert!(expanded.results.iter().any(|r| r.rel == "build/output.ts"));
        assert!(expanded.results.iter().any(|r| r.rel == ".hidden.ts"));
        assert!(!expanded.results.iter().any(|r| r.rel.starts_with(".git/")));
    }

    #[test]
    fn finds_every_matching_line_with_literal_case_insensitive_text() {
        let f = Fixture::new();
        f.file("a:b.ts", "😀 Needle[0]\nneedle[0]\nno match".as_bytes());
        let result = f.run("NEEDLE[0]", SearchMode::Contents);
        assert_eq!(result.results.len(), 2);
        assert_eq!(result.results[0].line, Some(1));
        assert_eq!(result.results[0].column, Some(4));
        assert_eq!(result.results[1].line, Some(2));
    }

    #[test]
    fn reports_result_and_scan_limits_instead_of_claiming_no_matches() {
        let f = Fixture::new();
        for index in 0..10 {
            f.file(&format!("file-{index}.txt"), b"match");
        }
        let mut request = f.request("file", SearchMode::Files);
        request.max_results = Some(2);
        let result = search(&request, &AtomicBool::new(false), Limits::default()).unwrap();
        assert_eq!(result.results.len(), 2);
        assert!(result.truncated);
        assert!(result.reason.unwrap().contains("More than 2"));
        let limited = search(
            &f.request("absent", SearchMode::Files),
            &AtomicBool::new(false),
            Limits {
                entries: 1,
                ..Limits::default()
            },
        )
        .unwrap();
        assert!(limited.truncated);
        assert!(limited.reason.unwrap().contains("scan limit"));
        let timed = search(
            &request,
            &AtomicBool::new(false),
            Limits {
                time: Duration::ZERO,
                ..Limits::default()
            },
        )
        .unwrap();
        assert!(timed.timed_out && timed.truncated);
    }

    #[test]
    fn reports_binary_and_large_skips_and_rejects_cancelled_or_invalid_scope() {
        let f = Fixture::new();
        f.file("binary.txt", b"needle\0");
        f.file("large.txt", b"needle needle needle");
        let result = search(
            &f.request("needle", SearchMode::Contents),
            &AtomicBool::new(false),
            Limits {
                file_bytes: 10,
                ..Limits::default()
            },
        )
        .unwrap();
        assert_eq!(result.skipped_files, 2);
        assert!(result.results.is_empty());
        assert!(search(
            &f.request("needle", SearchMode::Files),
            &AtomicBool::new(true),
            Limits::default()
        )
        .unwrap_err()
        .contains("cancelled"));
        let mut request = f.request("", SearchMode::Files);
        request.root = "relative".into();
        assert!(search(&request, &AtomicBool::new(false), Limits::default()).is_err());
    }

    #[test]
    fn worktree_git_pointer_is_not_an_error_and_git_metadata_cannot_be_the_scope() {
        let f = Fixture::new();
        f.file(".git", b"gitdir: /not-followed");
        f.file("src/app.ts", b"needle");
        let result = f.run("needle", SearchMode::Contents);
        assert_eq!(result.errors, 0);
        assert_eq!(result.results.len(), 1);
        let metadata = Fixture::new();
        metadata.file(".git/config", b"private metadata");
        let mut request = metadata.request("", SearchMode::Files);
        request.root = metadata.0.join(".git").to_str().unwrap().into();
        assert!(search(&request, &AtomicBool::new(false), Limits::default())
            .unwrap_err()
            .contains("Git metadata"));
    }

    #[test]
    fn exact_content_budget_still_searches_the_file_and_long_lines_show_the_hit() {
        let f = Fixture::new();
        let content = format!("{}needle", "x".repeat(1_000));
        f.file("long.txt", content.as_bytes());
        let result = search(
            &f.request("needle", SearchMode::Contents),
            &AtomicBool::new(false),
            Limits {
                bytes: content.len(),
                ..Limits::default()
            },
        )
        .unwrap();
        assert_eq!(result.results.len(), 1);
        assert!(!result.truncated);
        assert_eq!(result.results[0].column, Some(1001));
        assert!(result.results[0].text.as_ref().unwrap().contains("needle"));
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_file_directory_or_ignore_symlinks_outside_scope() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let external = Fixture::new();
        external.file("secret.txt", b"private needle");
        symlink(external.0.join("secret.txt"), f.0.join("linked.txt")).unwrap();
        symlink(&external.0, f.0.join("linked-dir")).unwrap();
        symlink(external.0.join("secret.txt"), f.0.join(".gitignore")).unwrap();
        let result = f.run("needle", SearchMode::Contents);
        assert!(result.results.is_empty());
        assert_eq!(result.skipped_files, 2);
        assert_eq!(result.errors, 1);
    }

    #[test]
    fn a_cancel_before_registration_leaves_a_bounded_tombstone() {
        let id = format!("cancel-before-{}", SEQUENCE.fetch_add(1, Ordering::SeqCst));
        workspace_search_cancel(id.clone()).unwrap();
        assert!(jobs()
            .lock()
            .unwrap()
            .get(&id)
            .unwrap()
            .cancelled
            .load(Ordering::Relaxed));
        jobs().lock().unwrap().remove(&id);
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_walk_rejects_a_parent_replaced_by_an_outside_symlink() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new();
        let external = Fixture::new();
        f.file("src/secret.txt", b"local");
        external.file("secret.txt", b"private");
        let root = File::open(&f.0).unwrap();
        fs::rename(f.0.join("src"), f.0.join("old-src")).unwrap();
        symlink(&external.0, f.0.join("src")).unwrap();
        assert!(open_at_root(&root, Path::new("src/secret.txt")).is_err());
    }
}
