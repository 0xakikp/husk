//! Shell integration.
//!
//! Instead of spawning a bare shell, we point the user's login shell at Husk's
//! own startup files (ZDOTDIR for zsh, `--rcfile` for bash, `--init-command`
//! for fish). Those files — bundled into the binary via `include_str!` and
//! written to `~/.cache/huskv2/shell-integration/` on first use — emit OSC 7
//! (cwd) and OSC 133 (prompt/command marks) so the GUI can follow the working
//! directory and command boundaries, and they bundle autosuggestions, syntax
//! highlighting and fzf key-bindings. Each script sources the user's own config
//! too, so personal setup is preserved and takes precedence.

use std::path::PathBuf;

use portable_pty::CommandBuilder;

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(Into::into)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(Into::into)
    }
}

/// Build the shell command for a new PTY, wired with Husk integration when the
/// shell is supported. Falls back to a plain shell otherwise.
pub fn build_command(cwd: Option<String>) -> Result<CommandBuilder, String> {
    #[cfg(unix)]
    {
        unix::build(cwd)
    }
    #[cfg(windows)]
    {
        windows::build(cwd)
    }
}

fn ensure_utf8_locale(cmd: &mut CommandBuilder) {
    let is_utf8 = |v: &str| {
        let up = v.to_ascii_uppercase();
        up.contains("UTF-8") || up.contains("UTF8")
    };
    let already_utf8 = ["LC_ALL", "LC_CTYPE", "LANG"]
        .iter()
        .any(|k| std::env::var(k).ok().as_deref().is_some_and(is_utf8));
    if already_utf8 {
        return;
    }
    #[cfg(target_os = "macos")]
    let fallback = "en_US.UTF-8";
    #[cfg(all(unix, not(target_os = "macos")))]
    let fallback = "C.UTF-8";
    #[cfg(windows)]
    let fallback = "en_US.UTF-8";
    cmd.env("LANG", fallback);
}

fn apply_common(cmd: &mut CommandBuilder, cwd: Option<String>) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("HUSKV2_TERMINAL", "1");
    ensure_utf8_locale(cmd);

    let resolved_cwd = cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        // In `tauri dev`, inherit the repo cwd so a fresh terminal opens in the
        // project the user launched from instead of `$HOME`. In production the
        // process cwd is the app bundle, so skip it and fall back to home.
        .or_else(|| {
            #[cfg(debug_assertions)]
            {
                std::env::current_dir().ok().filter(|p| p.is_dir())
            }
            #[cfg(not(debug_assertions))]
            {
                None
            }
        })
        .or_else(|| home_dir().filter(|p| p.is_dir()));
    if let Some(cwd) = resolved_cwd {
        #[cfg(windows)]
        let cwd = PathBuf::from(cwd.to_string_lossy().replace('/', "\\"));
        cmd.cwd(cwd);
    }
}

#[cfg(unix)]
mod unix {
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    use portable_pty::CommandBuilder;

    const ZSHENV: &str = include_str!("scripts/zshenv.zsh");
    const ZPROFILE: &str = include_str!("scripts/zprofile.zsh");
    const ZLOGIN: &str = include_str!("scripts/zlogin.zsh");
    const ZSHRC: &str = include_str!("scripts/zshrc.zsh");
    const ZSH_AUTOSUGGESTIONS: &str = include_str!("scripts/zsh-autosuggestions.zsh");
    const FZF_KEY_BINDINGS: &str = include_str!("scripts/fzf-key-bindings.zsh");
    const BASHRC: &str = include_str!("scripts/bashrc.bash");
    const FZF_KEY_BINDINGS_BASH: &str = include_str!("scripts/fzf-key-bindings.bash");
    const FISH_INIT: &str = include_str!("scripts/init.fish");

    // zsh-syntax-highlighting (MIT) — vendored from zsh-users/zsh-syntax-highlighting
    const ZSH_SYNTAX_HIGHLIGHTING: &str =
        include_str!("scripts/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh");
    const ZSH_SYNTAX_HIGHLIGHTER_MAIN: &str =
        include_str!("scripts/zsh-syntax-highlighting/highlighters/main/main-highlighter.zsh");
    const ZSH_SYNTAX_HIGHLIGHTER_BRACKETS: &str = include_str!(
        "scripts/zsh-syntax-highlighting/highlighters/brackets/brackets-highlighter.zsh"
    );
    const ZSH_SYNTAX_HIGHLIGHTER_CURSOR: &str = include_str!(
        "scripts/zsh-syntax-highlighting/highlighters/cursor/cursor-highlighter.zsh"
    );
    const ZSH_SYNTAX_HIGHLIGHTER_LINE: &str = include_str!(
        "scripts/zsh-syntax-highlighting/highlighters/line/line-highlighter.zsh"
    );
    const ZSH_SYNTAX_HIGHLIGHTER_PATTERN: &str = include_str!(
        "scripts/zsh-syntax-highlighting/highlighters/pattern/pattern-highlighter.zsh"
    );
    const ZSH_SYNTAX_HIGHLIGHTER_REGEXP: &str = include_str!(
        "scripts/zsh-syntax-highlighting/highlighters/regexp/regexp-highlighter.zsh"
    );
    const ZSH_SYNTAX_HIGHLIGHTER_ROOT: &str = include_str!(
        "scripts/zsh-syntax-highlighting/highlighters/root/root-highlighter.zsh"
    );

    pub enum Shell {
        Zsh,
        Bash,
        Fish,
        Other,
    }

    impl Shell {
        pub fn detect() -> (Shell, String) {
            let path = login_shell()
                .or_else(|| std::env::var("SHELL").ok())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "/bin/zsh".into());
            let name = path.rsplit('/').next().unwrap_or("").to_string();
            let shell = match name.as_str() {
                "zsh" => Shell::Zsh,
                "bash" => Shell::Bash,
                "fish" => Shell::Fish,
                _ => Shell::Other,
            };
            (shell, path)
        }
    }

    fn login_shell() -> Option<String> {
        use std::ffi::CStr;
        // SAFETY: getpwuid returns a pointer to static thread-local storage (or
        // an internal buffer). We null-check before dereferencing, and pw_shell
        // is a valid null-terminated C string returned by the OS.
        unsafe {
            let uid = libc::getuid();
            let pw = libc::getpwuid(uid);
            if pw.is_null() {
                return None;
            }
            let shell_ptr = (*pw).pw_shell;
            if shell_ptr.is_null() {
                return None;
            }
            CStr::from_ptr(shell_ptr).to_str().ok().map(String::from)
        }
    }

    pub fn build(cwd: Option<String>) -> Result<CommandBuilder, String> {
        let (shell, shell_path) = Shell::detect();
        let mut cmd = CommandBuilder::new(&shell_path);
        super::apply_common(&mut cmd, cwd);

        match shell {
            Shell::Zsh => {
                match prepare_zdotdir() {
                    Ok(zdotdir) => {
                        // Guard against Husk-in-Husk: only forward the user's
                        // real ZDOTDIR if it isn't already ours.
                        if let Ok(user_zd) = std::env::var("ZDOTDIR") {
                            if Path::new(&user_zd) != zdotdir.as_path() {
                                cmd.env("HUSK_USER_ZDOTDIR", user_zd);
                            }
                        }
                        cmd.env("ZDOTDIR", &zdotdir);
                    }
                    Err(e) => {
                        eprintln!("zsh shell integration disabled: {e}");
                    }
                }
                // Login shell so /etc/zprofile runs path_helper on macOS — without
                // this, GUI-launched apps get a minimal PATH missing Homebrew.
                cmd.arg("-l");
            }
            Shell::Bash => {
                match prepare_bash_rcfile() {
                    Ok(rc) => {
                        cmd.arg("--rcfile");
                        cmd.arg(rc);
                    }
                    Err(e) => {
                        eprintln!("bash shell integration disabled: {e}");
                    }
                }
                // bash ignores --rcfile under -l, so we use -i and source
                // /etc/profile from inside our rcfile to emulate login init.
                cmd.arg("-i");
            }
            Shell::Fish => {
                match prepare_fish_init() {
                    Ok(init) => {
                        cmd.arg("--init-command");
                        cmd.arg(format!("source {}", shell_quote(&init)));
                    }
                    Err(e) => {
                        eprintln!("fish shell integration disabled: {e}");
                    }
                }
                cmd.arg("-i");
            }
            Shell::Other => {
                eprintln!("unsupported shell '{shell_path}', spawning without integration");
            }
        }
        Ok(cmd)
    }

    fn shell_quote(p: &Path) -> String {
        let s = p.to_string_lossy();
        format!("'{}'", s.replace('\'', "'\\''"))
    }

    fn integration_root() -> Result<PathBuf, String> {
        let home = super::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
        let root = home.join(".cache").join("huskv2").join("shell-integration");
        fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
        Ok(root)
    }

    fn prepare_zdotdir() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("zsh");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        write_if_changed(&dir.join(".zshenv"), ZSHENV)?;
        write_if_changed(&dir.join(".zprofile"), ZPROFILE)?;
        write_if_changed(&dir.join(".zshrc"), ZSHRC)?;
        write_if_changed(&dir.join(".zlogin"), ZLOGIN)?;
        write_if_changed(&dir.join("zsh-autosuggestions.zsh"), ZSH_AUTOSUGGESTIONS)?;
        write_if_changed(&dir.join("fzf-key-bindings.zsh"), FZF_KEY_BINDINGS)?;

        // zsh-syntax-highlighting
        let zsh_hl = dir.join("zsh-syntax-highlighting");
        fs::create_dir_all(&zsh_hl).map_err(|e| format!("create {}: {e}", zsh_hl.display()))?;
        write_if_changed(&zsh_hl.join("zsh-syntax-highlighting.zsh"), ZSH_SYNTAX_HIGHLIGHTING)?;
        for (sub, content) in [
            ("main", ZSH_SYNTAX_HIGHLIGHTER_MAIN),
            ("brackets", ZSH_SYNTAX_HIGHLIGHTER_BRACKETS),
            ("cursor", ZSH_SYNTAX_HIGHLIGHTER_CURSOR),
            ("line", ZSH_SYNTAX_HIGHLIGHTER_LINE),
            ("pattern", ZSH_SYNTAX_HIGHLIGHTER_PATTERN),
            ("regexp", ZSH_SYNTAX_HIGHLIGHTER_REGEXP),
            ("root", ZSH_SYNTAX_HIGHLIGHTER_ROOT),
        ] {
            let d = zsh_hl.join("highlighters").join(sub);
            fs::create_dir_all(&d).map_err(|e| format!("create {}: {e}", d.display()))?;
            write_if_changed(&d.join(format!("{sub}-highlighter.zsh")), content)?;
        }

        Ok(dir)
    }

    fn prepare_bash_rcfile() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("bash");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let rc = dir.join("bashrc");
        write_if_changed(&rc, BASHRC)?;
        write_if_changed(&dir.join("fzf-key-bindings.bash"), FZF_KEY_BINDINGS_BASH)?;
        Ok(rc)
    }

    fn prepare_fish_init() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("fish");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let init = dir.join("init.fish");
        write_if_changed(&init, FISH_INIT)?;
        Ok(init)
    }

    fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
        if let Ok(existing) = fs::read_to_string(path) {
            if existing == content {
                return Ok(());
            }
        }
        // Atomic replace: a parallel shell startup must never source a half-written file.
        let mut tmp: OsString = path.as_os_str().to_owned();
        tmp.push(".__huskv2_tmp__");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename {} -> {}: {e}", tmp.display(), path.display())
        })
    }
}

#[cfg(windows)]
mod windows {
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    use portable_pty::CommandBuilder;

    const PROFILE_PS1: &str = include_str!("scripts/profile.ps1");

    pub fn build(cwd: Option<String>) -> Result<CommandBuilder, String> {
        let shell_path = super::windows_shell_path();
        let shell_name = shell_path
            .file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        let is_powershell = shell_name == "pwsh.exe" || shell_name == "powershell.exe";

        let mut cmd = CommandBuilder::new(&shell_path);
        super::apply_common(&mut cmd, cwd);

        if is_powershell {
            match prepare_ps_profile() {
                Ok(profile) => {
                    cmd.arg("-NoLogo");
                    cmd.arg("-NoExit");
                    cmd.arg("-ExecutionPolicy");
                    cmd.arg("Bypass");
                    cmd.arg("-File");
                    cmd.arg(profile);
                }
                Err(e) => {
                    eprintln!("powershell shell integration disabled: {e}");
                }
            }
        }
        Ok(cmd)
    }

    fn integration_root() -> Result<PathBuf, String> {
        let home = super::home_dir().ok_or_else(|| "could not resolve home dir".to_string())?;
        let root = home.join(".cache").join("huskv2").join("shell-integration");
        fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
        Ok(root)
    }

    fn prepare_ps_profile() -> Result<PathBuf, String> {
        let dir = integration_root()?.join("powershell");
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let file = dir.join("profile.ps1");
        write_if_changed(&file, PROFILE_PS1)?;
        Ok(file)
    }

    fn write_if_changed(path: &Path, content: &str) -> Result<(), String> {
        if let Ok(existing) = fs::read_to_string(path) {
            if existing == content {
                return Ok(());
            }
        }
        let mut tmp: OsString = path.as_os_str().to_owned();
        tmp.push(".__huskv2_tmp__");
        let tmp = PathBuf::from(tmp);
        fs::write(&tmp, content).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("rename {} -> {}: {e}", tmp.display(), path.display())
        })
    }
}

#[cfg(windows)]
pub fn windows_shell_path() -> PathBuf {
    if let Some(p) = which_in_path("pwsh.exe") {
        return p;
    }

    if let Some(pf) = std::env::var_os("ProgramFiles").map(PathBuf::from) {
        let candidate = pf.join("PowerShell").join("7").join("pwsh.exe");
        if candidate.is_file() {
            return candidate;
        }
    }

    let system32 = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32");
    let ps5 = system32
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    if ps5.is_file() {
        return ps5;
    }

    system32.join("cmd.exe")
}

#[cfg(windows)]
fn which_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}
