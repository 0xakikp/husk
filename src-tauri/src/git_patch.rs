//! Constrained selected-hunk staging. The renderer supplies the complete diff
//! it reviewed, not a patch to execute. We reread that diff under Git's index
//! lock, derive one text hunk, apply it only to a private index, and publish the
//! index atomically. Neither the working file nor HEAD is written.

use crate::shell::{resolve_configured_program, run_blocking_command, run_captured};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_PATCH: usize = 240 * 1024;
const MAX_INDEX: u64 = 64 * 1024 * 1024;
const DIFF_FLAGS: &[&str] = &[
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--unified=3",
    "--no-relative",
];

struct Git {
    program: PathBuf,
    cwd: PathBuf,
}

impl Git {
    fn command(&self, args: &[&str], index: Option<&Path>) -> Command {
        let mut command = Command::new(&self.program);
        // Ambient GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE must never redirect this
        // explicitly scoped operation to another repository or index.
        for (name, _) in std::env::vars_os() {
            if name.to_string_lossy().starts_with("GIT_") {
                command.env_remove(name);
            }
        }
        command
            .current_dir(&self.cwd)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            .args([
                "--no-pager",
                "--literal-pathspecs",
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.hooksPath=/dev/null",
            ])
            .args(args);
        #[cfg(test)]
        command
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null");
        if let Some(index) = index {
            command.env("GIT_INDEX_FILE", index);
        }
        command
    }
    fn read(&self, args: &[&str], index: Option<&Path>) -> Result<String, String> {
        let result = run_captured(self.command(args, index), Duration::from_secs(15))?;
        if result.timed_out || result.exit_code.is_none() {
            return Err("Git hunk staging timed out. The original index was not replaced; refresh before retrying.".into());
        }
        if result.exit_code != Some(0) {
            return Err(if result.stderr.trim().is_empty() {
                "Git could not stage this hunk. Refresh and review the file.".into()
            } else {
                result.stderr.trim().chars().take(2000).collect()
            });
        }
        if result.truncated || result.stdout.contains('\u{fffd}') {
            return Err("Git returned an incomplete or non-UTF-8 result. Stage this file in the terminal instead.".into());
        }
        Ok(result.stdout)
    }
    fn diff(&self, path: &str) -> Result<String, String> {
        let mut args = vec!["diff"];
        args.extend(DIFF_FLAGS);
        args.extend(["--", path]);
        self.read(&args, None)
    }
}

struct IndexLock {
    path: PathBuf,
    nested: PathBuf,
    published: bool,
    nested_owned: bool,
}
impl Drop for IndexLock {
    fn drop(&mut self) {
        if self.nested_owned {
            let _ = fs::remove_file(&self.nested);
        }
        if !self.published {
            let _ = fs::remove_file(&self.path);
        }
    }
}

/// The only temporary patch file is created inside a newly owned, private OS
/// temp directory. Its path is generated here, never supplied through IPC.
struct PatchDirectory(PathBuf);
impl Drop for PatchDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn patch_file(contents: &str) -> Result<(PatchDirectory, PathBuf), String> {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    for _ in 0..10 {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "husk-git-hunk-{}-{stamp}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        match builder.create(&dir) {
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
            Ok(()) => {}
        }
        let owned = PatchDirectory(dir);
        let path = owned.0.join("selected.patch");
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path).map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        return Ok((owned, path));
    }
    Err("Could not allocate a private patch file.".into())
}

fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.contains('\0')
        || path.chars().any(char::is_control)
        || Path::new(path)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || path.starts_with('\\')
        || path.contains('\\')
    {
        return Err("Hunk staging needs a normal, relative repository file path. Stage this file as a whole instead.".into());
    }
    Ok(())
}

fn range(value: &str, prefix: char) -> Result<(usize, usize), String> {
    let value = value.strip_prefix(prefix).ok_or("Invalid hunk range.")?;
    let mut pieces = value.split(',');
    let start = pieces
        .next()
        .unwrap_or("")
        .parse::<usize>()
        .map_err(|_| "Invalid hunk range.")?;
    let count = pieces
        .next()
        .unwrap_or("1")
        .parse::<usize>()
        .map_err(|_| "Invalid hunk count.")?;
    if pieces.next().is_some() || start > 100_000_000 || count > MAX_PATCH {
        return Err("Hunk range is too large.".into());
    }
    Ok((start, count))
}

fn selected_patch(diff: &str, path: &str, hunk_index: usize) -> Result<String, String> {
    if diff.is_empty()
        || diff.len() > MAX_PATCH
        || !diff.ends_with('\n')
        || diff.contains('\0')
        || diff.contains('\u{fffd}')
    {
        return Err("A complete, bounded UTF-8 diff is required to stage a hunk.".into());
    }
    let lines: Vec<&str> = diff[..diff.len() - 1].split('\n').collect();
    // Git appends a tab delimiter to ---/+++ headers for paths with spaces.
    // Actual control characters in paths are rejected above.
    if lines.len() < 6
        || lines[0] != format!("diff --git a/{path} b/{path}")
        || lines[2].strip_suffix('\t').unwrap_or(lines[2]) != format!("--- a/{path}")
        || lines[3].strip_suffix('\t').unwrap_or(lines[3]) != format!("+++ b/{path}")
    {
        return Err("Only a single regular-file text modification can be staged by hunk.".into());
    }
    let index: Vec<&str> = lines[1].split(' ').collect();
    if index.len() != 3 || index[0] != "index" || !matches!(index[2], "100644" | "100755") {
        return Err(
            "Mode changes, renames, binary files and symlinks must be staged as whole files."
                .into(),
        );
    }
    let ids: Vec<&str> = index[1].split("..").collect();
    if ids.len() != 2
        || ids
            .iter()
            .any(|id| id.is_empty() || !id.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err("Invalid patch object IDs.".into());
    }
    let mut i = 4;
    let mut hunk = 0;
    let mut selected = None;
    let mut previous_end = 0;
    while i < lines.len() {
        let header = lines[i];
        let mut fields = header.split(' ');
        if fields.next() != Some("@@") {
            return Err("Unsupported or incomplete hunk header.".into());
        }
        let (old_start, old_count) = range(fields.next().unwrap_or(""), '-')?;
        let (_new_start, new_count) = range(fields.next().unwrap_or(""), '+')?;
        if fields.next() != Some("@@") || old_start < previous_end {
            return Err("Invalid or overlapping hunk ranges.".into());
        }
        previous_end = old_start
            .checked_add(old_count)
            .ok_or("Invalid hunk range.")?;
        i += 1;
        let start = i;
        let (mut old_seen, mut new_seen, mut changed) = (0, 0, false);
        while i < lines.len() && !lines[i].starts_with("@@ ") {
            match lines[i].as_bytes().first() {
                Some(b' ') => {
                    old_seen += 1;
                    new_seen += 1;
                }
                Some(b'-') => {
                    old_seen += 1;
                    changed = true;
                }
                Some(b'+') => {
                    new_seen += 1;
                    changed = true;
                }
                _ if lines[i] == "\\ No newline at end of file" && i > start => {}
                _ => {
                    return Err(
                        "Unsupported patch data; refresh and stage the whole file instead.".into(),
                    )
                }
            }
            i += 1;
        }
        if old_seen != old_count || new_seen != new_count || !changed {
            return Err("Incomplete hunk contents.".into());
        }
        if hunk == hunk_index {
            // Earlier hunks are not being applied: the selected hunk's new
            // start must not include their line-count offsets.
            let new_start = if new_count == 0 {
                old_start.saturating_sub(1)
            } else if old_count == 0 {
                old_start + 1
            } else {
                old_start
            };
            selected = Some(format!(
                "{}\n@@ -{old_start},{old_count} +{new_start},{new_count} @@\n{}\n",
                lines[..4].join("\n"),
                lines[start..i].join("\n")
            ));
        }
        hunk += 1;
    }
    selected.ok_or_else(|| "The selected hunk no longer exists. Refresh the diff.".into())
}

fn stage_hunk(
    program: PathBuf,
    cwd: String,
    path: String,
    reviewed: String,
    hunk_index: usize,
) -> Result<(), String> {
    validate_path(&path)?;
    // Reject unsupported input before touching the repository lock.
    let patch = selected_patch(&reviewed, &path, hunk_index)?;
    let cwd = fs::canonicalize(&cwd).map_err(|e| format!("Cannot open repository: {e}"))?;
    let git = Git { program, cwd };
    let root = git.read(&["rev-parse", "--show-toplevel"], None)?;
    let root = PathBuf::from(root.strip_suffix('\n').unwrap_or(&root));
    if fs::canonicalize(root).map_err(|e| e.to_string())? != git.cwd {
        return Err("Open the repository root before staging a hunk.".into());
    }
    let target = git.cwd.join(&path);
    if !fs::symlink_metadata(&target)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_file()
        || !fs::canonicalize(&target)
            .map_err(|e| e.to_string())?
            .starts_with(&git.cwd)
    {
        return Err("Only regular files inside this repository can be staged by hunk.".into());
    }
    let index_path = git.read(
        &["rev-parse", "--path-format=absolute", "--git-path", "index"],
        None,
    )?;
    let index = PathBuf::from(index_path.strip_suffix('\n').unwrap_or(&index_path));
    if !index.is_absolute() {
        return Err("Git did not return an absolute index path.".into());
    }
    let meta = fs::symlink_metadata(&index).map_err(|e| format!("Cannot read Git index: {e}"))?;
    if !meta.file_type().is_file() || meta.len() > MAX_INDEX {
        return Err("This Git index is not supported for hunk staging. Use whole-file staging or the terminal.".into());
    }
    let mut lock_path = index.as_os_str().to_os_string();
    lock_path.push(".lock");
    let lock_path = PathBuf::from(lock_path);
    let mut nested = lock_path.as_os_str().to_os_string();
    nested.push(".lock");
    let nested = PathBuf::from(nested);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let lock_file = options.open(&lock_path).map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists { "Git is busy or an index lock exists. Finish the other Git operation before staging a hunk.".into() } else { format!("Cannot lock Git index: {e}") })?;
    let mut lock = IndexLock {
        path: lock_path,
        nested,
        published: false,
        nested_owned: false,
    };
    drop(lock_file);
    if lock.nested.exists() {
        return Err("An alternate-index lock already exists. No changes were made.".into());
    }
    // All normal Git index writers respect the index.lock held above.
    let locked_meta = fs::symlink_metadata(&index).map_err(|e| e.to_string())?;
    if !locked_meta.file_type().is_file() || locked_meta.len() > MAX_INDEX {
        return Err("The Git index changed or is too large. No changes were made.".into());
    }
    let entries = git.read(&["ls-files", "--stage", "-z", "--", &path], None)?;
    let expected_end = format!(" 0\t{path}\0");
    if entries.matches('\0').count() != 1
        || !entries.ends_with(&expected_end)
        || !(entries.starts_with("100644 ") || entries.starts_with("100755 "))
    {
        return Err("The file is untracked, conflicted, or no longer a regular indexed file. Refresh Git status.".into());
    }
    if git.diff(&path)? != reviewed {
        return Err("The file or index changed after this diff was opened. Refresh and review the new diff before staging.".into());
    }
    fs::copy(&index, &lock.path).map_err(|e| format!("Cannot prepare private index: {e}"))?;
    let (_temp, patch_path) = patch_file(&patch)?;
    let patch_path = patch_path
        .to_str()
        .ok_or("Temporary patch path is not UTF-8.")?;
    lock.nested_owned = true;
    // --cached targets only our alternate index, never the working tree.
    // No --3way, --reject, whitespace fixing or arbitrary caller flags.
    git.read(
        &["apply", "--cached", "--whitespace=nowarn", "--", patch_path],
        Some(&lock.path),
    )?;
    // If the worktree changed during apply, do not publish a review that no
    // longer matches it. The selected index remains private until rename.
    if git.diff(&path)? != reviewed {
        return Err("The file changed while staging. No index changes were published; refresh and review again.".into());
    }
    File::open(&lock.path)
        .and_then(|file| file.sync_all())
        .map_err(|e| format!("Cannot flush staged index: {e}"))?;
    fs::rename(&lock.path, &index).map_err(|e| format!("Cannot publish staged index: {e}"))?;
    lock.published = true;
    Ok(())
}

#[tauri::command]
pub async fn git_stage_diff_hunk(
    cwd: String,
    path: String,
    reviewed_diff: String,
    hunk_index: usize,
) -> Result<(), String> {
    run_blocking_command(move || {
        stage_hunk(
            resolve_configured_program("git")?,
            cwd,
            path,
            reviewed_diff,
            hunk_index,
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (PatchDirectory, Git) {
        let (directory, _) = patch_file("").unwrap();
        let cwd = directory.0.canonicalize().unwrap();
        let git = Git {
            program: resolve_configured_program("git").unwrap(),
            cwd,
        };
        git.read(&["init", "--template=", "--initial-branch=main"], None)
            .unwrap();
        git.read(&["config", "user.name", "Husk Test"], None)
            .unwrap();
        git.read(&["config", "user.email", "husk-test@example.invalid"], None)
            .unwrap();
        git.read(&["config", "commit.gpgSign", "false"], None)
            .unwrap();
        (directory, git)
    }
    fn initialize(git: &Git, path: &str, contents: &str) {
        fs::write(git.cwd.join(path), contents).unwrap();
        git.read(&["add", "--", path], None).unwrap();
        git.read(&["commit", "-m", "fixture"], None).unwrap();
    }
    fn stage(git: &Git, path: &str, reviewed: &str, index: usize) -> Result<(), String> {
        stage_hunk(
            git.program.clone(),
            git.cwd.to_str().unwrap().into(),
            path.into(),
            reviewed.into(),
            index,
        )
    }
    fn original() -> String {
        (1..=24).map(|line| format!("line {line}\n")).collect()
    }

    #[test]
    fn stages_only_selected_hunk_preserving_worktree_and_other_index_entries() {
        let (_fixture, git) = fixture();
        let original = original();
        initialize(&git, "example.txt", &original);
        fs::write(git.cwd.join("already-staged.txt"), "keep staged\n").unwrap();
        git.read(&["add", "--", "already-staged.txt"], None)
            .unwrap();
        let updated = original
            .replace("line 2\n", "line two\nextra line\n")
            .replace("line 22\n", "line twenty-two\n");
        fs::write(git.cwd.join("example.txt"), &updated).unwrap();
        let reviewed = git.diff("example.txt").unwrap();
        assert_eq!(reviewed.matches("\n@@ ").count(), 2);
        stage(&git, "example.txt", &reviewed, 1).unwrap();
        assert_eq!(
            git.read(&["show", ":example.txt"], None).unwrap(),
            original.replace("line 22\n", "line twenty-two\n")
        );
        assert_eq!(
            git.read(&["show", ":already-staged.txt"], None).unwrap(),
            "keep staged\n"
        );
        assert_eq!(
            fs::read_to_string(git.cwd.join("example.txt")).unwrap(),
            updated
        );
        assert!(!git.cwd.join(".git/index.lock").exists());
        assert!(!git.cwd.join(".git/index.lock.lock").exists());
    }

    #[test]
    fn refuses_stale_reviews_without_changing_the_index() {
        let (_fixture, git) = fixture();
        initialize(&git, "example.txt", "before\n");
        fs::write(git.cwd.join("example.txt"), "reviewed\n").unwrap();
        let reviewed = git.diff("example.txt").unwrap();
        fs::write(git.cwd.join("example.txt"), "changed again\n").unwrap();
        let before = fs::read(git.cwd.join(".git/index")).unwrap();
        assert!(stage(&git, "example.txt", &reviewed, 0)
            .unwrap_err()
            .contains("changed after"));
        assert_eq!(fs::read(git.cwd.join(".git/index")).unwrap(), before);
        assert!(!git.cwd.join(".git/index.lock").exists());
    }

    #[test]
    fn respects_existing_index_locks_without_removing_them() {
        let (_fixture, git) = fixture();
        initialize(&git, "example.txt", "before\n");
        fs::write(git.cwd.join("example.txt"), "after\n").unwrap();
        let reviewed = git.diff("example.txt").unwrap();
        fs::write(git.cwd.join(".git/index.lock"), "another operation").unwrap();
        assert!(stage(&git, "example.txt", &reviewed, 0)
            .unwrap_err()
            .contains("Git is busy"));
        assert_eq!(
            fs::read_to_string(git.cwd.join(".git/index.lock")).unwrap(),
            "another operation"
        );
    }

    #[test]
    fn handles_no_final_newline_and_empty_regular_files() {
        let (_fixture, git) = fixture();
        initialize(&git, "example.txt", "before");
        fs::write(git.cwd.join("example.txt"), "after").unwrap();
        stage(&git, "example.txt", &git.diff("example.txt").unwrap(), 0).unwrap();
        assert_eq!(git.read(&["show", ":example.txt"], None).unwrap(), "after");
        fs::write(git.cwd.join("example.txt"), "").unwrap();
        stage(&git, "example.txt", &git.diff("example.txt").unwrap(), 0).unwrap();
        assert_eq!(git.read(&["show", ":example.txt"], None).unwrap(), "");
    }

    #[test]
    fn supports_literal_spaces_in_paths_and_staged_modifications() {
        let (_fixture, git) = fixture();
        initialize(&git, "file with spaces.txt", &original());
        let staged = original().replace("line 2\n", "previously staged\n");
        fs::write(git.cwd.join("file with spaces.txt"), &staged).unwrap();
        git.read(&["add", "--", "file with spaces.txt"], None)
            .unwrap();
        let updated = staged.replace("line 22\n", "second change\n");
        fs::write(git.cwd.join("file with spaces.txt"), &updated).unwrap();
        stage(
            &git,
            "file with spaces.txt",
            &git.diff("file with spaces.txt").unwrap(),
            0,
        )
        .unwrap();
        assert_eq!(
            git.read(&["show", ":file with spaces.txt"], None).unwrap(),
            updated
        );
    }

    #[test]
    fn rejects_malformed_multi_file_and_non_text_input() {
        let valid = "diff --git a/a.txt b/a.txt\nindex 1111111..2222222 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-before\n+after\n";
        assert!(selected_patch(valid, "a.txt", 0).is_ok());
        for patch in [
            format!("{valid}{valid}"),
            valid.replace("100644", "120000"),
            valid.replace("@@ -1 +1 @@", "@@ -2,9 +1 @@"),
            valid.replace("+after\n", "+after"),
            format!("{valid}\0"),
            valid.replace("a/a.txt", "a/other.txt"),
        ] {
            assert!(selected_patch(&patch, "a.txt", 0).is_err());
        }
        assert!(selected_patch(valid, "a.txt", 4).is_err());
        for path in [
            "../outside",
            "/absolute",
            "x/../outside",
            ".",
            "a\nb",
            "x\\y",
        ] {
            assert!(validate_path(path).is_err());
        }
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinks_and_mode_changes() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let (_fixture, git) = fixture();
        initialize(&git, "example.txt", "before\n");
        fs::set_permissions(
            git.cwd.join("example.txt"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        fs::write(git.cwd.join("example.txt"), "after\n").unwrap();
        assert!(stage(&git, "example.txt", &git.diff("example.txt").unwrap(), 0).is_err());
        symlink("example.txt", git.cwd.join("link.txt")).unwrap();
        git.read(&["add", "--", "link.txt"], None).unwrap();
        fs::remove_file(git.cwd.join("link.txt")).unwrap();
        symlink("other.txt", git.cwd.join("link.txt")).unwrap();
        assert!(stage(&git, "link.txt", &git.diff("link.txt").unwrap(), 0).is_err());
    }
}
