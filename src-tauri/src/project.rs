//! Project profiles — per-repository instructions, runbooks, and safety
//! rules under `<workspaceRoot>/.husk/`.
//!
//! Every command validates that the resolved path stays inside the workspace
//! root before touching it: the profile directory is user-controlled, and a
//! symlinked `.husk` must never let reads or writes escape the project.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AiSection {
    pub include_instructions: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SafetySection {
    pub protected_environments: Option<Vec<String>>,
    pub protected_git_branches: Option<Vec<String>>,
    pub protected_kubernetes_contexts: Option<Vec<String>>,
    pub protected_aws_profiles: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectToml {
    pub version: Option<u32>,
    pub name: Option<String>,
    pub default_runbook: Option<String>,
    pub enabled: Option<bool>,
    pub ai: Option<AiSection>,
    pub safety: Option<SafetySection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Runbook {
    pub id: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub confirm: Option<bool>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectProfile {
    pub exists: bool,
    pub enabled: bool,
    pub name: Option<String>,
    pub default_runbook: Option<String>,
    pub include_instructions: bool,
    pub instructions: String,
    pub runbooks: Vec<Runbook>,
    pub environments_raw: String,
    pub safety: Option<SafetySection>,
    pub husk_dir: String,
}

fn empty_profile(husk_dir: &Path) -> ProjectProfile {
    ProjectProfile {
        exists: false,
        enabled: true,
        name: None,
        default_runbook: None,
        include_instructions: true,
        instructions: String::new(),
        runbooks: Vec::new(),
        environments_raw: String::new(),
        safety: None,
        husk_dir: husk_dir.to_string_lossy().to_string(),
    }
}

/// Resolve `<root>/.husk`, guaranteeing the result stays inside the
/// canonical workspace root even when `.husk` is a symlink.
fn validated_husk_dir(root: &str) -> Result<PathBuf, String> {
    let root_path = Path::new(root);
    if !root_path.is_absolute() {
        return Err("workspace root must be an absolute path".into());
    }
    let canonical_root =
        fs::canonicalize(root_path).map_err(|e| format!("cannot resolve workspace root: {e}"))?;
    let husk_dir = canonical_root.join(".husk");
    if husk_dir.exists() {
        let canonical = fs::canonicalize(&husk_dir)
            .map_err(|e| format!("cannot resolve .husk directory: {e}"))?;
        if !canonical.starts_with(&canonical_root) {
            return Err(".husk resolves outside the workspace — refusing to read it".into());
        }
        Ok(canonical)
    } else {
        Ok(husk_dir)
    }
}

/// Read a file only if its canonical path stays under `base`.
fn read_within(base: &Path, path: &Path) -> Result<String, String> {
    let canonical =
        fs::canonicalize(path).map_err(|e| format!("cannot resolve {}: {e}", path.display()))?;
    if !canonical.starts_with(base) {
        return Err(format!(
            "{} escapes the workspace — refused",
            path.display()
        ));
    }
    fs::read_to_string(&canonical).map_err(|e| format!("cannot read {}: {e}", canonical.display()))
}

/// Runbook ids become filenames, so they are restricted to a small alphabet;
/// anything else could walk out of the runbooks directory.
fn sanitize_runbook_id(id: &str) -> Result<String, String> {
    let cleaned: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else if c.is_whitespace() {
                '-'
            } else {
                '\0'
            }
        })
        .filter(|c| *c != '\0')
        .collect();
    let cleaned = cleaned.trim_matches('-').to_string();
    if cleaned.is_empty() {
        return Err("runbook id needs at least one letter or number".into());
    }
    Ok(cleaned)
}

fn load_profile(root: &str) -> Result<ProjectProfile, String> {
    let husk_dir = validated_husk_dir(root)?;
    if !husk_dir.is_dir() {
        return Ok(empty_profile(&husk_dir));
    }

    let mut profile = empty_profile(&husk_dir);
    profile.exists = true;

    let project_toml_path = husk_dir.join("project.toml");
    if project_toml_path.is_file() {
        let text = read_within(&husk_dir, &project_toml_path)?;
        let parsed: ProjectToml =
            toml::from_str(&text).map_err(|e| format!("project.toml is not valid TOML: {e}"))?;
        profile.enabled = parsed.enabled.unwrap_or(true);
        profile.name = parsed.name;
        profile.default_runbook = parsed.default_runbook;
        profile.include_instructions = parsed
            .ai
            .as_ref()
            .and_then(|ai| ai.include_instructions)
            .unwrap_or(true);
        profile.safety = parsed.safety;
    }

    let instructions_path = husk_dir.join("instructions.md");
    if instructions_path.is_file() {
        profile.instructions = read_within(&husk_dir, &instructions_path)?;
    }

    let environments_path = husk_dir.join("environments.toml");
    if environments_path.is_file() {
        profile.environments_raw = read_within(&husk_dir, &environments_path)?;
    }

    let runbooks_dir = husk_dir.join("runbooks");
    if runbooks_dir.is_dir() {
        let mut entries: Vec<PathBuf> = fs::read_dir(&runbooks_dir)
            .map_err(|e| format!("cannot list runbooks: {e}"))?
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|path| path.extension().is_some_and(|ext| ext == "toml"))
            .collect();
        entries.sort();
        for path in entries {
            let text = read_within(&husk_dir, &path)?;
            match toml::from_str::<Runbook>(&text) {
                Ok(mut runbook) => {
                    if runbook.id.is_none() {
                        runbook.id = path.file_stem().map(|s| s.to_string_lossy().to_string());
                    }
                    if runbook.command.as_deref().unwrap_or("").trim().is_empty() {
                        continue;
                    }
                    profile.runbooks.push(runbook);
                }
                Err(e) => {
                    eprintln!("husk: skipping invalid runbook {}: {e}", path.display());
                }
            }
        }
    }

    Ok(profile)
}

#[tauri::command]
pub fn project_profile_load(root: String) -> Result<ProjectProfile, String> {
    load_profile(&root)
}

const DEFAULT_PROJECT_TOML: &str = r#"version = 1
name = ""
default_runbook = ""

[ai]
include_instructions = true

[safety]
protected_environments = ["production"]
"#;

const DEFAULT_INSTRUCTIONS: &str = r#"# Project instructions

<!--
  Sent with every AI request in this workspace (when enabled above).
  Keep it short: stack, conventions, commands the AI should prefer.
  Never put secrets here — this file is attached to AI requests.
-->

- Package manager: pnpm
- Test command: pnpm test
"#;

#[tauri::command]
pub fn project_profile_init(root: String) -> Result<ProjectProfile, String> {
    let husk_dir = validated_husk_dir(&root)?;
    if husk_dir.is_dir() {
        return Err("a project profile already exists here".into());
    }
    let runbooks_dir = husk_dir.join("runbooks");
    fs::create_dir_all(&runbooks_dir).map_err(|e| format!("cannot create .husk: {e}"))?;
    fs::write(husk_dir.join("project.toml"), DEFAULT_PROJECT_TOML)
        .map_err(|e| format!("cannot write project.toml: {e}"))?;
    fs::write(husk_dir.join("instructions.md"), DEFAULT_INSTRUCTIONS)
        .map_err(|e| format!("cannot write instructions.md: {e}"))?;
    load_profile(&root)
}

#[tauri::command]
pub fn project_profile_write_instructions(
    root: String,
    content: String,
) -> Result<ProjectProfile, String> {
    let husk_dir = validated_husk_dir(&root)?;
    if !husk_dir.is_dir() {
        return Err("no project profile — initialize one first".into());
    }
    let target = husk_dir.join("instructions.md");
    fs::write(&target, content).map_err(|e| format!("cannot write instructions.md: {e}"))?;
    load_profile(&root)
}

#[tauri::command]
pub fn project_profile_set_enabled(root: String, enabled: bool) -> Result<ProjectProfile, String> {
    let husk_dir = validated_husk_dir(&root)?;
    let path = husk_dir.join("project.toml");
    let text = read_within(&husk_dir, &path)?;
    let mut doc: toml::Value =
        toml::from_str(&text).map_err(|e| format!("project.toml is not valid TOML: {e}"))?;
    doc["enabled"] = toml::Value::Boolean(enabled);
    let out =
        toml::to_string_pretty(&doc).map_err(|e| format!("cannot serialize project.toml: {e}"))?;
    fs::write(&path, out).map_err(|e| format!("cannot write project.toml: {e}"))?;
    load_profile(&root)
}

#[tauri::command]
pub fn project_runbook_save(root: String, runbook: Runbook) -> Result<ProjectProfile, String> {
    let husk_dir = validated_husk_dir(&root)?;
    if !husk_dir.is_dir() {
        return Err("no project profile — initialize one first".into());
    }
    let id = sanitize_runbook_id(runbook.id.as_deref().unwrap_or(""))?;
    if runbook.command.as_deref().unwrap_or("").trim().is_empty() {
        return Err("a runbook needs a command".into());
    }
    let to_save = Runbook {
        id: Some(id.clone()),
        ..runbook
    };
    let text =
        toml::to_string_pretty(&to_save).map_err(|e| format!("cannot serialize runbook: {e}"))?;
    let path = husk_dir.join("runbooks").join(format!("{id}.toml"));
    fs::write(&path, text).map_err(|e| format!("cannot write runbook: {e}"))?;
    load_profile(&root)
}

#[tauri::command]
pub fn project_runbook_delete(root: String, id: String) -> Result<ProjectProfile, String> {
    let husk_dir = validated_husk_dir(&root)?;
    let id = sanitize_runbook_id(&id)?;
    let path = husk_dir.join("runbooks").join(format!("{id}.toml"));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("cannot delete runbook: {e}"))?;
    }
    load_profile(&root)
}
