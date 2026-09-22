//! One-shot shell command runner (distinct from the interactive PTY).
//! Used by infrastructure clients and custom tools to run a CLI and
//! capture its output, with a timeout and output cap.
//!
//! Security: commands are executed directly via std::process::Command with an
//! explicit program and argument array. No shell is invoked, so shell
//! metacharacters in arguments are treated as literal data.

use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::ffi::CStr;
#[cfg(unix)]
use std::os::fd::AsRawFd;
#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

use serde::Serialize;

const MAX_OUT: usize = 256 * 1024;
const MAX_TIMEOUT_SECS: u64 = 300;
const PIPE_POLL: Duration = Duration::from_millis(10);
const FINAL_DRAIN: Duration = Duration::from_millis(100);

/// Shell interpreters that must never be invoked directly. These are excluded
/// to prevent callers from bypassing the no-shell rule by passing
/// `sh -c '...'` or similar.
const SHELL_NAMES: &[&str] = &[
    "sh",
    "bash",
    "zsh",
    "cmd",
    "cmd.exe",
    "powershell",
    "powershell.exe",
    "pwsh",
    "pwsh.exe",
];

/// Characters that are not allowed in a program path. None of these can appear
/// in a safe binary name or absolute path.
fn program_has_metachar(program: &str) -> bool {
    program.chars().any(|c| {
        matches!(
            c,
            ';' | '|'
                | '&'
                | '$'
                | '('
                | ')'
                | '`'
                | '<'
                | '>'
                | '*'
                | '?'
                | '['
                | ']'
                | '{'
                | '}'
                | '~'
                | ' '
                | '\n'
                | '\t'
                | '"'
                | '\''
        )
    })
}

/// Return the shell selected for this account, even when Husk was launched by
/// Finder/Dock and therefore did not inherit a terminal's `$SHELL` or `$PATH`.
/// On Unix the account record is the durable source of truth; `$SHELL` wins
/// when it is available because it reflects the user's active preference.
fn user_login_shell() -> PathBuf {
    if let Some(shell) = std::env::var_os("SHELL") {
        let path = PathBuf::from(shell);
        if path.is_file() {
            return path;
        }
    }

    #[cfg(unix)]
    // SAFETY: `getpwuid` returns a pointer owned by libc for the current user.
    // We immediately copy the `pw_shell` string while reading it and never keep
    // the returned pointer beyond this block.
    unsafe {
        let passwd = libc::getpwuid(libc::geteuid());
        if !passwd.is_null() && !(*passwd).pw_shell.is_null() {
            let shell = CStr::from_ptr((*passwd).pw_shell).to_string_lossy();
            let path = PathBuf::from(shell.as_ref());
            if path.is_file() {
                return path;
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let zsh = PathBuf::from("/bin/zsh");
        if zsh.is_file() {
            return zsh;
        }
    }

    PathBuf::from("sh")
}

fn uses_interactive_config(shell: &Path) -> bool {
    matches!(
        shell.file_name().and_then(|name| name.to_str()),
        Some("bash" | "zsh" | "fish" | "ksh" | "mksh")
    )
}

/// Run `command -v` in the user's actual login shell. Interactive config is
/// intentionally loaded for shells that support it: CLIs installed through
/// nvm, fnm, asdf, Homebrew, or a user-managed `~/.local/bin` often appear
/// only there, while GUI applications otherwise inherit a minimal PATH.
fn resolve_via_login_shell(program: &str) -> Option<PathBuf> {
    let shell = user_login_shell();
    let script = format!("command -v {}", shell_quote(program));
    let args = if uses_interactive_config(&shell) {
        "-lic"
    } else {
        "-lc"
    };
    let mut command = Command::new(shell);
    command.arg(args).arg(script);
    // A broken or chatty login configuration must not leave CLI detection
    // running forever. Reuse the runner directly, without recursive validation.
    let output = run_captured(command, Duration::from_secs(3)).ok()?;

    if output.exit_code != Some(0) || output.timed_out || output.truncated {
        return None;
    }

    // Startup files occasionally print a banner. `command -v` writes its
    // result last, so scanning backwards makes detection robust without
    // treating any arbitrary line as executable input.
    output
        .stdout
        .lines()
        .rev()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .find(|candidate| candidate.is_file())
}

/// Resolve a binary name or absolute path to an executable path.
/// Uses the current process PATH first, then falls back to the actual user's
/// login shell. This lets GUI-launched apps find Homebrew, nvm, and other
/// tools configured for the user's terminal.
fn resolve_binary_path(program: &str) -> Result<PathBuf, String> {
    if program.is_empty() {
        return Err("program is empty".to_string());
    }
    if program_has_metachar(program) {
        return Err(format!("program contains shell metacharacters: {program}"));
    }

    let path = Path::new(program);
    let base = path.file_stem().and_then(|s| s.to_str()).unwrap_or(program);
    let base_lower = base.to_lowercase();
    if SHELL_NAMES.iter().any(|s| *s == base_lower) {
        return Err(format!(
            "'{program}' is a shell interpreter and is not allowed"
        ));
    }

    // Absolute path: use as-is if it exists.
    if path.is_absolute() {
        if !path.is_file() {
            return Err(format!("program does not exist: {program}"));
        }
        return Ok(path.to_path_buf());
    }

    // Search current process PATH.
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidate = dir.join(program);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    if let Some(candidate) = resolve_via_login_shell(program) {
        return Ok(candidate);
    }

    Err(format!("program not found on PATH: {program}"))
}

/// Validate that `program` is a real executable and not a shell interpreter.
/// Returns the resolved absolute path so the caller can use it directly.
pub fn validate_program(program: &str) -> Result<PathBuf, String> {
    resolve_binary_path(program)
}

/// Quote a single token for safe interpolation into a POSIX shell command.
/// Used only by the trusted detection helper, not for arbitrary user input.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[derive(Debug, Serialize)]
pub struct ShellOutput {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    timed_out: bool,
    truncated: bool,
}

#[derive(Default)]
struct CapturedStream {
    bytes: Vec<u8>,
    truncated: bool,
    closed: bool,
}

impl CapturedStream {
    fn append(&mut self, chunk: &[u8]) {
        let keep = chunk.len().min(MAX_OUT.saturating_sub(self.bytes.len()));
        self.bytes.extend_from_slice(&chunk[..keep]);
        self.truncated |= keep < chunk.len();
    }

    fn into_text(self) -> (String, bool) {
        let mut text = String::from_utf8_lossy(&self.bytes).into_owned();
        let mut truncated = self.truncated;
        // Invalid UTF-8 can expand into multi-byte replacement characters.
        // Keep the decoded result bounded too, on a valid UTF-8 boundary.
        if text.len() > MAX_OUT {
            let mut boundary = MAX_OUT;
            while !text.is_char_boundary(boundary) {
                boundary -= 1;
            }
            text.truncate(boundary);
            truncated = true;
        }
        (text, truncated)
    }
}

trait CapturePipe: Read {
    fn prepare_capture(&self) -> io::Result<()>;
    fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<usize>;
}

#[cfg(unix)]
impl<T: Read + AsRawFd> CapturePipe for T {
    fn prepare_capture(&self) -> io::Result<()> {
        // Only the parent's owned read end is changed. A nonblocking drain
        // avoids reader threads that outlive a timed-out command's pipes.
        let fd = self.as_raw_fd();
        // SAFETY: fd belongs to this live ChildStdout/ChildStderr handle.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.read(buffer)
    }
}

#[cfg(windows)]
impl<T: Read + AsRawHandle> CapturePipe for T {
    fn prepare_capture(&self) -> io::Result<()> {
        Ok(())
    }

    fn read_available(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        #[link(name = "kernel32")]
        extern "system" {
            fn PeekNamedPipe(
                pipe: *mut std::ffi::c_void,
                buffer: *mut std::ffi::c_void,
                buffer_size: u32,
                bytes_read: *mut u32,
                available: *mut u32,
                message_bytes: *mut u32,
            ) -> i32;
        }
        let mut available = 0;
        // SAFETY: this is our live anonymous pipe read handle. Peek performs
        // no writes except to `available`; all other output pointers are null.
        let ok = unsafe {
            PeekNamedPipe(
                self.as_raw_handle(),
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
                &mut available,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 {
            let error = io::Error::last_os_error();
            if matches!(error.raw_os_error(), Some(109 | 232 | 233)) {
                return Ok(0); // Broken/disconnected pipe: the writer exited.
            }
            return Err(error);
        }
        if available == 0 {
            return Err(io::ErrorKind::WouldBlock.into());
        }
        // This is the sole reader, so these already-buffered bytes cannot
        // disappear between Peek and ReadFile. Never wait for future bytes.
        let count = buffer.len().min(available as usize);
        self.read(&mut buffer[..count])
    }
}

/// Read a fair, bounded chunk from each pipe, retaining at most MAX_OUT while
/// continuing to drain excess bytes so chatty children cannot deadlock.
fn drain_pipe(pipe: &mut impl CapturePipe, captured: &mut CapturedStream) -> io::Result<bool> {
    if captured.closed {
        return Ok(false);
    }
    let mut buffer = [0_u8; 8192];
    let mut progressed = false;
    for _ in 0..8 {
        match pipe.read_available(&mut buffer) {
            Ok(0) => {
                captured.closed = true;
                break;
            }
            Ok(count) => {
                captured.append(&buffer[..count]);
                progressed = true;
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
            Err(error) => return Err(error),
        }
    }
    Ok(progressed)
}

/// The child remains unreaped until both pipes close or cleanup runs, so its
/// PID cannot be recycled before we signal the isolated Unix process group.
fn terminate_and_reap(child: &mut Child) -> io::Result<()> {
    #[cfg(unix)]
    {
        let pid = child.id();
        if pid > 0 && pid <= i32::MAX as u32 {
            // SAFETY: process_group(0) made this child the leader of its own
            // group at spawn, never Husk's or an inherited terminal's group.
            unsafe { libc::kill(-(pid as libc::pid_t), libc::SIGKILL) };
        }
    }
    // Also covers Windows and a child that explicitly left its Unix group.
    if let Err(error) = child.kill() {
        // An already-exited process is harmless; a process we cannot signal
        // must not turn an error path into an indefinite blocking wait.
        return match child.try_wait()? {
            Some(_) => Ok(()),
            None => Err(error),
        };
    }
    child.wait().map(|_| ())
}

fn run_captured(mut command: Command, timeout: Duration) -> Result<ShellOutput, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);

    let started = Instant::now();
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let mut stdout = child.stdout.take().expect("stdout was configured as piped");
    let mut stderr = child.stderr.take().expect("stderr was configured as piped");
    let mut out = CapturedStream::default();
    let mut err = CapturedStream::default();
    let mut reaped = false;
    let result = (|| -> io::Result<(Option<i32>, bool)> {
        stdout.prepare_capture()?;
        stderr.prepare_capture()?;
        loop {
            let progressed =
                drain_pipe(&mut stdout, &mut out)? | drain_pipe(&mut stderr, &mut err)?;
            if out.closed && err.closed {
                if let Some(status) = child.try_wait()? {
                    reaped = true;
                    return Ok((status.code(), false));
                }
            }
            if started.elapsed() >= timeout {
                terminate_and_reap(&mut child)?;
                reaped = true;
                // Collect already-buffered final bytes, but do not hang on a
                // descendant that escaped the group and kept a pipe open.
                let draining = Instant::now();
                while (!out.closed || !err.closed) && draining.elapsed() < FINAL_DRAIN {
                    let progressed =
                        drain_pipe(&mut stdout, &mut out)? | drain_pipe(&mut stderr, &mut err)?;
                    if !progressed && (!out.closed || !err.closed) {
                        thread::sleep(PIPE_POLL);
                    }
                }
                out.truncated |= !out.closed;
                err.truncated |= !err.closed;
                if err.bytes.is_empty() {
                    err.append(b"command timed out");
                }
                return Ok((None, true));
            }
            if !progressed {
                thread::sleep(PIPE_POLL.min(timeout.saturating_sub(started.elapsed())));
            }
        }
    })();
    let (exit_code, timed_out) = match result {
        Ok(result) => result,
        Err(error) => {
            let cleanup = if reaped {
                Ok(())
            } else {
                terminate_and_reap(&mut child)
            };
            return Err(match cleanup {
                Ok(()) => error.to_string(),
                Err(cleanup) => format!("{error}; process cleanup failed: {cleanup}"),
            });
        }
    };
    let (stdout, stdout_truncated) = out.into_text();
    let (stderr, stderr_truncated) = err.into_text();
    Ok(ShellOutput {
        stdout,
        stderr,
        exit_code,
        timed_out,
        truncated: stdout_truncated || stderr_truncated,
    })
}

#[tauri::command]
pub fn shell_run_command(
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_secs: Option<u64>,
) -> Result<ShellOutput, String> {
    let resolved_program = validate_program(&program)?;
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(20).min(MAX_TIMEOUT_SECS));
    let mut command = Command::new(resolved_program);
    command.args(args);
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    run_captured(command, timeout)
}

/// Detect which of the requested binaries are installed.
/// Runs `command -v` through the user's login shell so Homebrew and other
/// PATH modifications are applied, matching the behaviour of an interactive
/// shell. Each name is validated and quoted before reaching the shell.
#[tauri::command]
pub fn detect_binaries(bins: Vec<String>) -> Result<Vec<String>, String> {
    let mut found = Vec::new();

    for bin in bins {
        if bin.is_empty() {
            continue;
        }
        if program_has_metachar(&bin) {
            continue;
        }
        // Reject shell interpreters being asked for as a "binary".
        let base = Path::new(&bin)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(&bin)
            .to_lowercase();
        if SHELL_NAMES.iter().any(|s| *s == base) {
            continue;
        }

        if resolve_binary_path(&bin).is_ok() {
            found.push(bin);
        }
    }

    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command.args([
            "--exact",
            "shell::tests::command_fixture",
            "--nocapture",
            "--test-threads=1",
        ]);
        command.env("HUSK_SHELL_TEST_FIXTURE", mode);
        command
    }

    // Runs in an isolated child test process only. No shell interpreter,
    // external service, installed CLI, or user's startup configuration needed.
    #[test]
    fn command_fixture() {
        let Ok(mode) = std::env::var("HUSK_SHELL_TEST_FIXTURE") else {
            return;
        };
        match mode.as_str() {
            "normal" => {
                println!("fixture stdout");
                eprintln!("fixture stderr");
            }
            "nonzero" => {
                eprintln!("fixture failure");
                std::process::exit(7);
            }
            "large" => {
                let chunk = [b'x'; 8192];
                for _ in 0..128 {
                    std::io::stdout().write_all(&chunk).unwrap();
                    std::io::stderr().write_all(&chunk).unwrap();
                }
                std::io::stdout().flush().unwrap();
                std::io::stderr().flush().unwrap();
            }
            "wait" => {
                println!("FIXTURE_PID={}", std::process::id());
                std::io::stdout().flush().unwrap();
                thread::sleep(Duration::from_secs(30));
            }
            "group" | "orphan-pipe" => {
                let mut descendant = fixture("wait").spawn().unwrap();
                println!("DESCENDANT_PID={}", descendant.id());
                println!("LEADER_PID={}", std::process::id());
                std::io::stdout().flush().unwrap();
                if mode == "orphan-pipe" {
                    std::process::exit(0);
                }
                let _ = descendant.wait();
            }
            _ => panic!("unknown fixture mode"),
        }
    }

    #[test]
    fn captures_normal_output_and_nonzero_exit() {
        let output = run_captured(fixture("normal"), Duration::from_secs(5)).unwrap();
        assert!(output.stdout.contains("fixture stdout"));
        assert!(output.stderr.contains("fixture stderr"));
        assert_eq!(output.exit_code, Some(0));
        assert!(!output.timed_out && !output.truncated);

        let output = run_captured(fixture("nonzero"), Duration::from_secs(5)).unwrap();
        assert!(output.stderr.contains("fixture failure"));
        assert_eq!(output.exit_code, Some(7));
        assert!(!output.timed_out && !output.truncated);
    }

    #[test]
    fn drains_large_stdout_and_stderr_without_retaining_all_output() {
        let output = run_captured(fixture("large"), Duration::from_secs(5)).unwrap();
        assert_eq!(output.stdout.len(), MAX_OUT);
        assert_eq!(output.stderr.len(), MAX_OUT);
        assert_eq!(output.exit_code, Some(0));
        assert!(output.truncated);
        assert!(!output.timed_out);
    }

    #[test]
    fn capture_cap_is_exact_and_decoded_output_stays_bounded() {
        let mut captured = CapturedStream::default();
        captured.append(&vec![b'x'; MAX_OUT]);
        assert!(!captured.truncated);
        captured.append(b"extra");
        assert_eq!(captured.bytes.len(), MAX_OUT);
        assert!(captured.truncated);

        let mut invalid_utf8 = CapturedStream::default();
        invalid_utf8.append(&vec![0xff; MAX_OUT]);
        let (text, truncated) = invalid_utf8.into_text();
        assert!(text.len() <= MAX_OUT && truncated);
        assert!(!text.is_empty());
    }

    fn output_pid(output: &str, marker: &str) -> u32 {
        let start = output.find(marker).expect("fixture reported its PID") + marker.len();
        output[start..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect::<String>()
            .parse()
            .unwrap()
    }

    #[cfg(unix)]
    fn assert_reaped(pid: u32) {
        let mut status = 0;
        // SAFETY: WNOHANG only checks the exact child created by this test.
        assert_eq!(
            unsafe { libc::waitpid(pid as libc::pid_t, &mut status, libc::WNOHANG) },
            -1
        );
        assert_eq!(
            io::Error::last_os_error().raw_os_error(),
            Some(libc::ECHILD)
        );
    }

    #[test]
    fn timeout_stops_and_reaps_the_child_and_retains_partial_output() {
        let started = Instant::now();
        let output = run_captured(fixture("wait"), Duration::from_millis(750)).unwrap();
        assert!(started.elapsed() < Duration::from_secs(3));
        assert!(output.timed_out);
        assert_eq!(output.exit_code, None);
        assert!(!output.truncated);
        let pid = output_pid(&output.stdout, "FIXTURE_PID=");
        #[cfg(unix)]
        assert_reaped(pid);
        #[cfg(not(unix))]
        let _ = pid;
    }

    #[cfg(unix)]
    #[test]
    fn timeout_cleans_the_isolated_group_even_after_leader_exit() {
        for mode in ["group", "orphan-pipe"] {
            let output = run_captured(fixture(mode), Duration::from_millis(750)).unwrap();
            assert!(output.timed_out);
            assert!(
                !output.truncated,
                "killed group should close all pipe writers"
            );
            let leader = output_pid(&output.stdout, "LEADER_PID=");
            let descendant = output_pid(&output.stdout, "DESCENDANT_PID=");
            assert_reaped(leader);
            assert_eq!(descendant, output_pid(&output.stdout, "FIXTURE_PID="));
            // The descendant entered its 30s wait with both pipes inherited.
            // EOF within 850ms (not truncated) proves those writers terminated,
            // without invoking ps or depending on OS orphan-zombie reap timing.
        }
    }

    #[test]
    fn spawn_failures_and_invalid_working_directories_are_reported() {
        let command = Command::new("/nonexistent/husk-shell-fixture");
        assert!(run_captured(command, Duration::from_secs(1)).is_err());
        let mut command = fixture("normal");
        command.current_dir("/nonexistent/husk-shell-fixture-cwd");
        assert!(run_captured(command, Duration::from_secs(1)).is_err());
    }
}
