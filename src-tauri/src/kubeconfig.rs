//! Explicit, immutable kubeconfig sources for the Kubernetes inspector.
//!
//! Resolving a source only checks path metadata/readability. It never reads a
//! config's contents, runs kubectl, or changes Husk's environment or directory.
//! Kubectl itself may run authentication plugins from a config, so the UI must
//! ask users to trust an explicitly selected file before using it.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::shell::{run_captured, validate_program, ShellOutput};

const MAX_CONFIG_PATHS: usize = 64;
const MAX_PATH_BYTES: usize = 32_768;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConfigKind {
    App,
    File,
    Terminal,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfigRequest {
    kind: ConfigKind,
    path: Option<String>,
    kubeconfig: Option<String>,
    cwd: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSource {
    kind: ConfigKind,
    paths: Vec<String>,
    cwd: String,
    fingerprint: String,
    label: String,
    missing_paths: Vec<String>,
    uses_default: bool,
    path_separator: String,
}

fn path_text(path: &Path) -> Result<String, String> {
    let text = path
        .to_str()
        .ok_or_else(|| "The kubeconfig path is not valid Unicode.".to_string())?;
    if text.is_empty() || text.len() > MAX_PATH_BYTES || text.chars().any(char::is_control) {
        return Err(
            "The kubeconfig path is empty, too long, or contains control characters.".into(),
        );
    }
    Ok(text.to_owned())
}

fn working_directory(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("The kubeconfig source needs an absolute working directory. Wait for a local shell prompt and try again.".into());
    }
    path_text(path)?;
    if !path.is_dir() {
        return Err(format!(
            "The kubeconfig source directory is not available: {}. Choose a file directly or return to an existing directory.",
            path.display()
        ));
    }
    Ok(path.to_path_buf())
}

fn absolute_path(path: &Path, cwd: &Path) -> Result<PathBuf, String> {
    path_text(path)?;
    let result = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    // Do not canonicalize symlinks or '..': kubectl resolves referenced
    // certificates relative to the original config location, not its target.
    path_text(&result)?;
    Ok(result)
}

fn joined_paths(paths: &[PathBuf]) -> Result<OsString, String> {
    if paths.is_empty() || paths.len() > MAX_CONFIG_PATHS {
        return Err(format!(
            "Select between 1 and {MAX_CONFIG_PATHS} kubeconfig files."
        ));
    }
    for path in paths {
        path_text(path)?;
        if !path.is_absolute() {
            return Err(
                "Kubeconfig source paths must be absolute. Select the source again.".into(),
            );
        }
    }
    std::env::join_paths(paths).map_err(|_| {
        "A kubeconfig filename contains the platform's path-list separator and cannot be used in KUBECONFIG. Rename the file and select it again.".into()
    })
}

fn check_file(path: &Path, allow_missing: bool) -> Result<bool, String> {
    match std::fs::metadata(path) {
        Ok(metadata) if !metadata.is_file() => Err(format!(
            "Kubeconfig must be a regular file, not a directory or device: {}",
            path.display()
        )),
        Ok(_) => File::open(path).map(|_| true).map_err(|error| {
            format!(
                "Cannot open kubeconfig {}: {error}. Check its read permissions.",
                path.display()
            )
        }),
        Err(error) if allow_missing && error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Cannot access kubeconfig {}: {error}. Select an existing readable file.",
            path.display()
        )),
    }
}

// Environment/home/cwd are arguments so tests never read or alter real config
// contents, account settings, or the process environment.
fn resolve_source(
    request: ConfigRequest,
    inherited: Option<&OsStr>,
    home: Option<&Path>,
    app_cwd: &Path,
) -> Result<ConfigSource, String> {
    if request.kind == ConfigKind::Terminal
        && request
            .kubeconfig
            .as_deref()
            .map(str::is_empty)
            .unwrap_or(true)
    {
        return Err("The terminal must report an explicit config path, including its own home config when KUBECONFIG is unset. Open a new local terminal or choose a file instead.".into());
    }
    let cwd = match request.kind {
        ConfigKind::Terminal => working_directory(Path::new(request.cwd.as_deref().ok_or(
            "The terminal has not reported its working directory. Wait for a local shell prompt and try again.",
        )?))?,
        _ => working_directory(app_cwd)?,
    };
    let raw_list = match request.kind {
        ConfigKind::App => inherited,
        ConfigKind::Terminal => request.kubeconfig.as_deref().map(OsStr::new),
        ConfigKind::File => None,
    };
    let uses_default =
        request.kind != ConfigKind::File && raw_list.map(|value| value.is_empty()).unwrap_or(true);
    let unqualified = if request.kind == ConfigKind::File {
        vec![PathBuf::from(
            request
                .path
                .as_deref()
                .ok_or("Choose a kubeconfig file first.")?,
        )]
    } else if uses_default {
        vec![home
            .ok_or("Husk could not find your home directory. Choose a kubeconfig file instead.")?
            .join(".kube")
            .join("config")]
    } else {
        // split_paths implements ':' on Unix and ';' (including drive letters
        // and quoted path components) on Windows. Kubernetes ignores empty
        // entries in a nonempty KUBECONFIG list; do not fall back to ~/.kube/config.
        std::env::split_paths(raw_list.unwrap())
            .filter(|path| !path.as_os_str().is_empty())
            .collect::<Vec<_>>()
    };
    if unqualified.is_empty() {
        return Err("KUBECONFIG contains only empty path entries. Export at least one file path, or unset KUBECONFIG to use the default.".into());
    }
    if unqualified.len() > MAX_CONFIG_PATHS {
        return Err(format!(
            "KUBECONFIG has more than {MAX_CONFIG_PATHS} entries. Use a smaller path list."
        ));
    }
    let mut paths = Vec::new();
    for path in unqualified {
        let path = absolute_path(&path, &cwd)?;
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    joined_paths(&paths)?;
    let mut missing_paths = Vec::new();
    for path in &paths {
        // Kubectl normally tolerates absent app-default/merged files. Explicit
        // file and terminal exports should fail clearly rather than inspecting
        // a surprising partial configuration. A terminal's unset export has
        // already been expanded to its own explicit home config by integration.
        if !check_file(path, request.kind == ConfigKind::App || uses_default)? {
            missing_paths.push(path_text(path)?);
        }
    }
    let paths = paths
        .iter()
        .map(|path| path_text(path))
        .collect::<Result<Vec<_>, _>>()?;
    let cwd = path_text(&cwd)?;
    // Exact serialization, not a lossy hash: distinct sources must never share
    // an inspector cache identity. Contains paths only, never file contents.
    let fingerprint = serde_json::to_string(&(request.kind, &paths, &cwd))
        .map_err(|error| format!("Could not identify kubeconfig source: {error}"))?;
    let label = match request.kind {
        ConfigKind::App => "App default",
        ConfigKind::File => "Selected file",
        ConfigKind::Terminal => "Terminal snapshot",
    }
    .to_owned();
    Ok(ConfigSource {
        kind: request.kind,
        paths,
        cwd,
        fingerprint,
        label,
        missing_paths,
        uses_default,
        path_separator: if cfg!(windows) { ";" } else { ":" }.to_owned(),
    })
}

#[tauri::command]
pub async fn kubernetes_resolve_config(request: ConfigRequest) -> Result<ConfigSource, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let inherited = std::env::var_os("KUBECONFIG");
        let home = dirs::home_dir();
        let app_cwd = std::env::current_dir()
            .map_err(|error| format!("Husk's working directory is unavailable: {error}"))?;
        resolve_source(request, inherited.as_deref(), home.as_deref(), &app_cwd)
    })
    .await
    .map_err(|error| format!("Could not resolve kubeconfig source: {error}"))?
}

fn pinned_command(
    program: &Path,
    args: &[String],
    paths: &[PathBuf],
    cwd: &Path,
) -> Result<Command, String> {
    if args
        .iter()
        .any(|arg| arg == "--kubeconfig" || arg.starts_with("--kubeconfig="))
    {
        return Err(
            "The Kubernetes command cannot override the selected kubeconfig source.".into(),
        );
    }
    let joined = joined_paths(paths)?;
    let cwd = working_directory(cwd)?;
    let mut command = Command::new(program);
    command
        .args(args)
        .env("KUBECONFIG", joined)
        .current_dir(cwd);
    Ok(command)
}

fn pinned_executable(program: &Path, lookup_cwd: &Path) -> Result<PathBuf, String> {
    // PATH may include '.' or another relative directory. Resolve that path
    // against the directory used for CLI discovery, before the command switches
    // to the terminal source's cwd; otherwise it could launch a different file.
    let absolute = if program.is_absolute() {
        program.to_path_buf()
    } else {
        lookup_cwd.join(program)
    };
    if !absolute.is_absolute() {
        return Err("Cannot pin kubectl without an absolute CLI discovery directory.".into());
    }
    // Keep symlinks and argv[0] intact: CLI-manager shims may dispatch based on
    // the invoked filename. Making the path absolute is sufficient to prevent
    // child cwd from changing its meaning; canonicalization is unnecessary.
    Ok(absolute)
}

/// All inspector reads use the exact resolved source, regardless of subsequent
/// terminal tab/environment changes. Other inherited environment (e.g. cloud
/// auth) remains the app's; terminal credentials are deliberately not imported.
#[tauri::command]
pub async fn kubernetes_run_command(
    args: Vec<String>,
    kubeconfig_paths: Vec<String>,
    cwd: String,
    timeout_secs: Option<u64>,
) -> Result<ShellOutput, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = kubeconfig_paths
            .iter()
            .map(PathBuf::from)
            .collect::<Vec<_>>();
        // Validate the snapshot before resolving a binary through login shell.
        let _ = pinned_command(Path::new("kubectl"), &args, &paths, Path::new(&cwd))?;
        let lookup_cwd = std::env::current_dir()
            .map_err(|error| format!("Husk's working directory is unavailable: {error}"))?;
        let program = pinned_executable(&validate_program("kubectl")?, &lookup_cwd)?;
        let command = pinned_command(&program, &args, &paths, Path::new(&cwd))?;
        let timeout = Duration::from_secs(timeout_secs.unwrap_or(20).clamp(1, 300));
        run_captured(command, timeout)
    })
    .await
    .map_err(|error| format!("Could not run Kubernetes command: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "husk-kubeconfig-test-{}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            // create_dir (not create_dir_all) refuses to adopt an existing path.
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn file(&self, name: &str) -> PathBuf {
            let path = self.0.join(name);
            std::fs::write(&path, "deliberately not a real kubeconfig").unwrap();
            path
        }

        fn resolve(
            &self,
            request: ConfigRequest,
            inherited: Option<&OsStr>,
        ) -> Result<ConfigSource, String> {
            resolve_source(request, inherited, Some(&self.0), &self.0)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn request(kind: ConfigKind) -> ConfigRequest {
        ConfigRequest {
            kind,
            path: None,
            kubeconfig: None,
            cwd: None,
        }
    }

    #[test]
    fn app_default_is_pinned_even_when_default_file_does_not_exist() {
        let fixture = Fixture::new();
        let source = fixture.resolve(request(ConfigKind::App), None).unwrap();
        assert_eq!(
            source.paths,
            vec![fixture.0.join(".kube/config").to_str().unwrap()]
        );
        assert_eq!(source.missing_paths, source.paths);
        assert!(source.uses_default);
        let empty = fixture
            .resolve(request(ConfigKind::App), Some(OsStr::new("")))
            .unwrap();
        assert_eq!(source.fingerprint, empty.fingerprint);
    }

    #[test]
    fn app_inherited_merge_list_is_absolute_deduplicated_and_allows_missing_files() {
        let fixture = Fixture::new();
        let first = fixture.file("first config");
        let second = fixture.0.join("missing");
        let inherited = std::env::join_paths([Path::new("first config"), &second, &first]).unwrap();
        let source = fixture
            .resolve(request(ConfigKind::App), Some(&inherited))
            .unwrap();
        assert_eq!(
            source.paths,
            vec![first.to_str().unwrap(), second.to_str().unwrap()]
        );
        assert_eq!(source.missing_paths, vec![second.to_str().unwrap()]);
        assert!(!source.uses_default);
    }

    #[test]
    fn file_selection_does_not_parse_or_leak_contents() {
        let fixture = Fixture::new();
        let file = fixture.file("chosen.yaml");
        let source = fixture
            .resolve(
                ConfigRequest {
                    path: Some(file.to_str().unwrap().into()),
                    ..request(ConfigKind::File)
                },
                None,
            )
            .unwrap();
        assert_eq!(source.paths, vec![file.to_str().unwrap()]);
        let json = serde_json::to_string(&source).unwrap();
        assert!(!json.contains("deliberately"));
        assert!(json.contains("missingPaths"));
    }

    #[test]
    fn terminal_paths_are_resolved_from_snapshot_cwd_not_app_cwd() {
        let fixture = Fixture::new();
        let terminal_dir = fixture.0.join("terminal");
        std::fs::create_dir(&terminal_dir).unwrap();
        let relative_file = terminal_dir.join("terminal.yaml");
        std::fs::write(&relative_file, "not parsed").unwrap();
        let absolute_file = fixture.file("other.yaml");
        let list = std::env::join_paths([Path::new("terminal.yaml"), &absolute_file]).unwrap();
        let source = fixture
            .resolve(
                ConfigRequest {
                    kubeconfig: Some(list.into_string().unwrap()),
                    cwd: Some(terminal_dir.to_str().unwrap().into()),
                    ..request(ConfigKind::Terminal)
                },
                Some(OsStr::new("unrelated-app.yaml")),
            )
            .unwrap();
        assert_eq!(
            source.paths,
            vec![
                relative_file.to_str().unwrap(),
                absolute_file.to_str().unwrap()
            ]
        );
        assert_eq!(source.cwd, terminal_dir.to_str().unwrap());
        assert!(!source.uses_default);
    }

    #[test]
    fn terminal_requires_its_own_default_path_and_missing_export_fails() {
        let fixture = Fixture::new();
        for value in [None, Some(String::new())] {
            let error = fixture
                .resolve(
                    ConfigRequest {
                        kubeconfig: value,
                        cwd: Some(fixture.0.to_str().unwrap().into()),
                        ..request(ConfigKind::Terminal)
                    },
                    Some(OsStr::new("unrelated-app.yaml")),
                )
                .unwrap_err();
            assert!(error.contains("terminal must report an explicit config path"));
        }
        let terminal_default = fixture.file("terminal-home-config");
        let source = fixture
            .resolve(
                ConfigRequest {
                    kubeconfig: Some(terminal_default.to_str().unwrap().into()),
                    cwd: Some(fixture.0.to_str().unwrap().into()),
                    ..request(ConfigKind::Terminal)
                },
                Some(OsStr::new("unrelated-app.yaml")),
            )
            .unwrap();
        assert_eq!(source.paths, vec![terminal_default.to_str().unwrap()]);
        let error = fixture
            .resolve(
                ConfigRequest {
                    kubeconfig: Some("missing.yaml".into()),
                    cwd: Some(fixture.0.to_str().unwrap().into()),
                    ..request(ConfigKind::Terminal)
                },
                None,
            )
            .unwrap_err();
        assert!(error.contains("Select an existing readable file"));
    }

    #[test]
    fn invalid_explicit_file_or_directory_is_rejected() {
        let fixture = Fixture::new();
        for path in [
            "missing.yaml".to_owned(),
            fixture.0.to_str().unwrap().into(),
            "bad\nfile".into(),
            String::new(),
        ] {
            assert!(fixture
                .resolve(
                    ConfigRequest {
                        path: Some(path),
                        ..request(ConfigKind::File)
                    },
                    None
                )
                .is_err());
        }
        assert!(fixture.resolve(request(ConfigKind::File), None).is_err());
        assert!(fixture
            .resolve(request(ConfigKind::Terminal), None)
            .is_err());
        assert!(fixture
            .resolve(
                ConfigRequest {
                    cwd: Some("relative-dir".into()),
                    ..request(ConfigKind::Terminal)
                },
                None
            )
            .is_err());
    }

    #[test]
    fn only_empty_path_entries_do_not_silently_fall_back() {
        let fixture = Fixture::new();
        let separator = if cfg!(windows) { ";;" } else { "::" };
        let error = fixture
            .resolve(request(ConfigKind::App), Some(OsStr::new(separator)))
            .unwrap_err();
        assert!(error.contains("only empty path entries"));
    }

    #[test]
    fn distinct_source_paths_or_cwd_cannot_share_a_fingerprint() {
        let fixture = Fixture::new();
        let first = fixture.file("one.yaml");
        let second = fixture.file("two.yaml");
        let first_source = fixture
            .resolve(
                ConfigRequest {
                    path: Some(first.to_str().unwrap().into()),
                    ..request(ConfigKind::File)
                },
                None,
            )
            .unwrap();
        let second_source = fixture
            .resolve(
                ConfigRequest {
                    path: Some(second.to_str().unwrap().into()),
                    ..request(ConfigKind::File)
                },
                None,
            )
            .unwrap();
        assert_ne!(first_source.fingerprint, second_source.fingerprint);
        let same_source = fixture
            .resolve(
                ConfigRequest {
                    path: Some(first.to_str().unwrap().into()),
                    ..request(ConfigKind::File)
                },
                None,
            )
            .unwrap();
        assert_eq!(first_source.fingerprint, same_source.fingerprint);
    }

    #[test]
    fn command_pins_only_child_config_and_keeps_arguments_literal() {
        let fixture = Fixture::new();
        let first = fixture.file("first config");
        let second = fixture.file("second config");
        let original_env = std::env::var_os("KUBECONFIG");
        let original_cwd = std::env::current_dir().unwrap();
        let args = vec![
            "--context".into(),
            "context with spaces;not-shell".into(),
            "get".into(),
            "pods".into(),
        ];
        let command = pinned_command(
            Path::new("kubectl"),
            &args,
            &[first.clone(), second.clone()],
            &fixture.0,
        )
        .unwrap();
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            args.iter().map(OsStr::new).collect::<Vec<_>>()
        );
        assert_eq!(command.get_current_dir(), Some(fixture.0.as_path()));
        let envs = command.get_envs().collect::<Vec<_>>();
        assert_eq!(
            envs,
            vec![(
                OsStr::new("KUBECONFIG"),
                Some(std::env::join_paths([first, second]).unwrap().as_os_str())
            )]
        );
        assert_eq!(std::env::var_os("KUBECONFIG"), original_env);
        assert_eq!(std::env::current_dir().unwrap(), original_cwd);
    }

    #[test]
    fn command_cannot_override_or_drop_its_source() {
        let fixture = Fixture::new();
        let file = fixture.file("config.yaml");
        for flag in ["--kubeconfig", "--kubeconfig=/other/config"] {
            assert!(pinned_command(
                Path::new("kubectl"),
                &[flag.into()],
                &[file.clone()],
                &fixture.0
            )
            .is_err());
        }
        assert!(pinned_command(Path::new("kubectl"), &[], &[], &fixture.0).is_err());
        assert!(pinned_command(
            Path::new("kubectl"),
            &[],
            &[PathBuf::from("relative.yaml")],
            &fixture.0
        )
        .is_err());
    }

    #[test]
    fn relative_executable_stays_bound_to_discovery_directory_after_child_cwd_changes() {
        let fixture = Fixture::new();
        let lookup_dir = fixture.0.join("app");
        let terminal_dir = fixture.0.join("terminal");
        for dir in [&lookup_dir, &terminal_dir] {
            std::fs::create_dir(dir).unwrap();
            std::fs::create_dir(dir.join("bin")).unwrap();
            // Plain text fixtures are deliberately never executed.
            std::fs::write(dir.join("bin/kubectl"), "fixture executable path only").unwrap();
        }
        let config = fixture.file("config.yaml");
        let original_cwd = std::env::current_dir().unwrap();
        let original_path = std::env::var_os("PATH");
        let executable = pinned_executable(Path::new("bin/kubectl"), &lookup_dir).unwrap();
        let command = pinned_command(&executable, &[], &[config], &terminal_dir).unwrap();

        assert!(Path::new(command.get_program()).is_absolute());
        assert_eq!(
            command.get_program(),
            lookup_dir.join("bin/kubectl").as_os_str()
        );
        assert_ne!(
            command.get_program(),
            terminal_dir.join("bin/kubectl").as_os_str()
        );
        assert_eq!(command.get_current_dir(), Some(terminal_dir.as_path()));
        assert_eq!(
            pinned_executable(&executable, &terminal_dir).unwrap(),
            executable
        );
        assert_eq!(std::env::current_dir().unwrap(), original_cwd);
        assert_eq!(std::env::var_os("PATH"), original_path);
    }
}
