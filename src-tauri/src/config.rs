//! Native, user-owned Husk configuration.
//!
//! This is deliberately separate from the generic file commands used by the
//! editor. The frontend can read and save one validated document, but cannot
//! choose an arbitrary path. That keeps durable app preferences predictable,
//! portable across reinstalls, and safe from partial writes.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};

const CONFIG_VERSION: u64 = 1;
const MAX_CONFIG_BYTES: u64 = 4 * 1024 * 1024;
const CONFIG_DIR: &str = ".husk";
const CONFIG_FILE: &str = "config.toml";
const AGENTS_DIR: &str = "agents";
// All app windows share this lock. Read/merge/write is one transaction, rather
// than each webview replacing a stale copy of the whole document.
static CONFIG_REVISION: Mutex<u64> = Mutex::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigLoad {
    pub path: String,
    pub exists: bool,
    pub document: Option<Value>,
    pub error: Option<String>,
    pub revision: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSave {
    pub path: String,
    pub document: Value,
    pub revision: u64,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigPatch {
    pub path: Vec<String>,
    // Absence (or null) deletes an optional key. Arrays are atomic values;
    // object fields are patched individually, including nested preferences.
    pub value: Option<Value>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDocument {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub system_prompt: String,
    pub model: Option<String>,
    pub color: Option<String>,
    pub built_in: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentHeader {
    id: String,
    name: String,
    icon: String,
    model: Option<String>,
    color: Option<String>,
    built_in: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLoad {
    pub dir: String,
    pub agents: Vec<AgentDocument>,
    pub errors: Vec<String>,
}

fn config_path() -> Result<PathBuf, String> {
    let home =
        dirs::home_dir().ok_or_else(|| "could not resolve the home directory".to_string())?;
    Ok(home.join(CONFIG_DIR).join(CONFIG_FILE))
}

fn husk_root() -> Result<PathBuf, String> {
    let home =
        dirs::home_dir().ok_or_else(|| "could not resolve the home directory".to_string())?;
    Ok(home.join(CONFIG_DIR))
}

fn agents_dir() -> Result<PathBuf, String> {
    Ok(husk_root()?.join(AGENTS_DIR))
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_file_name("config.toml.bak")
}

fn config_error(message: impl Into<String>) -> String {
    format!("Husk config: {}", message.into())
}

fn is_secret_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.contains("token")
        || name.contains("secret")
        || name.contains("password")
        || name.contains("api_key")
        || name.contains("apikey")
        || name.contains("private_key")
}

fn expect_object<'a>(
    value: &'a Value,
    label: &str,
) -> Result<&'a serde_json::Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| config_error(format!("{label} must be a table")))
}

fn validate_mcp(value: &Value) -> Result<(), String> {
    let table = expect_object(value, "mcp")?;
    let Some(servers) = table.get("servers") else {
        return Ok(());
    };
    let servers = servers
        .as_array()
        .ok_or_else(|| config_error("mcp.servers must be an array"))?;

    for server in servers {
        let server = expect_object(server, "each MCP server")?;
        if let Some(env) = server.get("env") {
            let env = expect_object(env, "MCP server env")?;
            for (name, value) in env {
                if is_secret_name(name) && value.as_str().is_some_and(|v| !v.is_empty()) {
                    return Err(config_error(format!(
                        "MCP environment variable `{name}` looks like a secret. Store it in the OS keychain and reference it through secret_env instead."
                    )));
                }
            }
        }
        if let Some(secret_env) = server.get("secretEnv") {
            let secret_env = expect_object(secret_env, "MCP server secretEnv")?;
            if secret_env.values().any(|value| !value.is_string()) {
                return Err(config_error(
                    "MCP secretEnv values must be OS-keychain account names",
                ));
            }
        }
    }

    Ok(())
}

fn validate_document(document: &Value) -> Result<(), String> {
    let table = expect_object(document, "the root document")?;
    let version = table
        .get("config_version")
        .and_then(Value::as_u64)
        .ok_or_else(|| config_error("config_version must be a positive integer"))?;

    if version != CONFIG_VERSION {
        return Err(config_error(format!(
            "config_version {version} is not supported by this Husk build"
        )));
    }

    for key in ["preferences", "ai", "mcp", "appearance_presets"] {
        if let Some(value) = table.get(key) {
            expect_object(value, key)?;
        }
    }
    if let Some(mcp) = table.get("mcp") {
        validate_mcp(mcp)?;
    }

    Ok(())
}

fn ensure_config_dir(path: &Path) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| config_error("config path has no parent directory"))?;
    fs::create_dir_all(dir).map_err(|e| config_error(format!("create {}: {e}", dir.display())))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Agent files can be written before config.toml during first-run
        // migration. Protect the shared root as well as the immediate parent.
        if dir.file_name().and_then(|name| name.to_str()) == Some(AGENTS_DIR) {
            if let Some(root) = dir.parent() {
                fs::set_permissions(root, fs::Permissions::from_mode(0o700))
                    .map_err(|e| config_error(format!("protect {}: {e}", root.display())))?;
            }
        }
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
            .map_err(|e| config_error(format!("protect {}: {e}", dir.display())))?;
    }

    Ok(())
}

/// Write bytes in the destination directory, sync them, then replace the old
/// file. A crash can leave an ignored temp file, but never a half-written
/// config. The replacement is atomic on the platforms Husk supports when both
/// paths are on the same volume, which this helper guarantees.
fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    ensure_config_dir(path)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| config_error(e.to_string()))?
        .as_nanos();
    let tmp = path.with_file_name(format!(
        ".{CONFIG_FILE}.{}.{}.tmp",
        std::process::id(),
        stamp
    ));

    let write_result = (|| -> Result<(), String> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&tmp)
            .map_err(|e| config_error(format!("create {}: {e}", tmp.display())))?;
        file.write_all(contents)
            .map_err(|e| config_error(format!("write {}: {e}", tmp.display())))?;
        file.sync_all()
            .map_err(|e| config_error(format!("sync {}: {e}", tmp.display())))?;
        fs::rename(&tmp, path)
            .map_err(|e| config_error(format!("replace {}: {e}", path.display())))?;

        #[cfg(unix)]
        {
            let dir = File::open(path.parent().expect("config path has parent"))
                .map_err(|e| config_error(format!("open config directory: {e}")))?;
            dir.sync_all()
                .map_err(|e| config_error(format!("sync config directory: {e}")))?;
        }
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    write_result
}

fn write_document(path: &Path, document: &Value) -> Result<(), String> {
    validate_document(document)?;
    let text = toml::to_string_pretty(document)
        .map_err(|e| config_error(format!("serialize TOML: {e}")))?;
    if text.len() as u64 > MAX_CONFIG_BYTES {
        return Err(config_error("refusing to write a config larger than 4 MiB"));
    }

    if let Ok(existing) = fs::read(path) {
        if existing == text.as_bytes() {
            return Ok(());
        }
        atomic_write(&backup_path(path), &existing)?;
    }
    atomic_write(path, text.as_bytes())
}

fn valid_agent_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn validate_agent(agent: &AgentDocument) -> Result<(), String> {
    if !valid_agent_id(&agent.id) {
        return Err(config_error(
            "agent id must contain only letters, numbers, hyphens, or underscores",
        ));
    }
    if agent.name.trim().is_empty() || agent.name.chars().count() > 80 {
        return Err(config_error(
            "agent name must be between 1 and 80 characters",
        ));
    }
    if agent.system_prompt.trim().is_empty() || agent.system_prompt.len() > 32_000 {
        return Err(config_error(
            "agent prompt must be between 1 and 32,000 characters",
        ));
    }
    if agent.icon.chars().count() > 16 {
        return Err(config_error("agent icon is too long"));
    }
    Ok(())
}

fn agent_path(id: &str) -> Result<PathBuf, String> {
    if !valid_agent_id(id) {
        return Err(config_error("invalid agent id"));
    }
    Ok(agents_dir()?.join(format!("{id}.md")))
}

fn serialise_agent(agent: &AgentDocument) -> Result<String, String> {
    validate_agent(agent)?;
    let header = AgentHeader {
        id: agent.id.clone(),
        name: agent.name.trim().to_string(),
        icon: agent.icon.trim().to_string(),
        model: agent
            .model
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        color: agent
            .color
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        built_in: agent.built_in,
    };
    let header = toml::to_string_pretty(&header)
        .map_err(|e| config_error(format!("serialize agent header: {e}")))?;
    Ok(format!(
        "+++\n{header}+++\n\n{}\n",
        agent.system_prompt.trim()
    ))
}

fn parse_agent(path: &Path, contents: &str) -> Result<AgentDocument, String> {
    let rest = contents.strip_prefix("+++\n").ok_or_else(|| {
        config_error(format!(
            "{} must start with TOML front matter (`+++`)",
            path.display()
        ))
    })?;
    let (header, prompt) = rest
        .split_once("\n+++\n")
        .ok_or_else(|| config_error(format!("{} is missing the closing `+++`", path.display())))?;
    let header = toml::from_str::<AgentHeader>(header)
        .map_err(|e| config_error(format!("parse {}: {e}", path.display())))?;
    let agent = AgentDocument {
        id: header.id,
        name: header.name,
        icon: header.icon,
        model: header.model,
        color: header.color,
        built_in: header.built_in,
        system_prompt: prompt.trim().to_string(),
    };
    validate_agent(&agent)?;
    Ok(agent)
}

#[tauri::command]
pub fn config_load(_app: AppHandle) -> Result<ConfigLoad, String> {
    let revision = CONFIG_REVISION
        .lock()
        .map_err(|_| config_error("settings lock is unavailable"))?;
    let path = config_path()?;
    let path_string = path.to_string_lossy().to_string();
    if !path.exists() {
        return Ok(ConfigLoad {
            path: path_string,
            exists: false,
            document: None,
            error: None,
            revision: *revision,
        });
    }

    let result = read_document(&path);

    match result {
        Ok(document) => Ok(ConfigLoad {
            path: path_string,
            exists: true,
            document: Some(document),
            error: None,
            revision: *revision,
        }),
        Err(error) => Ok(ConfigLoad {
            path: path_string,
            exists: true,
            document: None,
            error: Some(error),
            revision: *revision,
        }),
    }
}

fn read_document(path: &Path) -> Result<Value, String> {
    let meta =
        fs::metadata(path).map_err(|e| config_error(format!("inspect {}: {e}", path.display())))?;
    if meta.len() > MAX_CONFIG_BYTES {
        return Err(config_error("config.toml is larger than 4 MiB"));
    }
    if !meta.is_file() {
        return Err(config_error("config.toml must be a regular file"));
    }
    let text = fs::read_to_string(path)
        .map_err(|e| config_error(format!("read {}: {e}", path.display())))?;
    let document = toml::from_str::<Value>(&text)
        .map_err(|e| config_error(format!("parse {}: {e}", path.display())))?;
    validate_document(&document)?;
    Ok(document)
}

/// Migration is create-only. A second window must adopt the winning document,
/// and a malformed/existing file must never be silently replaced.
fn initialise_document(path: &Path, document: Value) -> Result<Value, String> {
    if path.exists() {
        return read_document(path);
    }
    write_document(path, &document)?;
    Ok(document)
}

#[tauri::command]
pub fn config_save(app: AppHandle, document: Value) -> Result<ConfigSave, String> {
    let mut revision = CONFIG_REVISION
        .lock()
        .map_err(|_| config_error("settings lock is unavailable"))?;
    let path = config_path()?;
    let document = initialise_document(&path, document)?;
    *revision += 1;
    let saved = ConfigSave {
        path: path.to_string_lossy().to_string(),
        document,
        revision: *revision,
    };
    let _ = app.emit("husk:config-changed", &saved);
    Ok(saved)
}

fn patch_document(document: &mut Value, patches: &[ConfigPatch]) -> Result<(), String> {
    if patches.len() > 2048 {
        return Err(config_error("too many settings edits in one save"));
    }
    for patch in patches {
        if patch.path.len() < 2
            || patch.path.len() > 8
            || !matches!(
                patch.path[0].as_str(),
                "preferences" | "ai" | "mcp" | "appearance_presets"
            )
            || patch.path.iter().any(|key| {
                key.is_empty()
                    || key.len() > 256
                    || matches!(key.as_str(), "__proto__" | "prototype" | "constructor")
            })
        {
            return Err(config_error("invalid settings edit path"));
        }
        let mut target = &mut *document;
        for key in &patch.path[..patch.path.len() - 1] {
            let object = target
                .as_object_mut()
                .ok_or_else(|| config_error("settings edit parent must be a table"))?;
            target = object
                .entry(key.clone())
                .or_insert_with(|| Value::Object(Default::default()));
            // Preferences tolerate an invalid individual field at load. A
            // deliberate edit to that field should repair its malformed
            // container, not make every later save fail forever.
            if !target.is_object() {
                *target = Value::Object(Default::default());
            }
        }
        let object = target
            .as_object_mut()
            .ok_or_else(|| config_error("settings edit parent must be a table"))?;
        let key = patch.path.last().expect("validated path");
        match &patch.value {
            Some(value) => {
                object.insert(key.clone(), value.clone());
            }
            None => {
                object.remove(key);
            }
        }
    }
    validate_document(document)
}

fn patch_file(path: &Path, patches: &[ConfigPatch]) -> Result<Value, String> {
    let mut document = read_document(path)?;
    patch_document(&mut document, patches)?;
    write_document(path, &document)?;
    Ok(document)
}

#[tauri::command]
pub fn config_patch(app: AppHandle, patches: Vec<ConfigPatch>) -> Result<ConfigSave, String> {
    let mut revision = CONFIG_REVISION
        .lock()
        .map_err(|_| config_error("settings lock is unavailable"))?;
    let path = config_path()?;
    let document = patch_file(&path, &patches)?;
    *revision += 1;
    let saved = ConfigSave {
        path: path.to_string_lossy().to_string(),
        document,
        revision: *revision,
    };
    let _ = app.emit("husk:config-changed", &saved);
    Ok(saved)
}

#[tauri::command]
pub fn config_location(_app: AppHandle) -> Result<String, String> {
    Ok(config_path()?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn agents_load(_app: AppHandle) -> Result<AgentLoad, String> {
    let dir = agents_dir()?;
    if !dir.exists() {
        return Ok(AgentLoad {
            dir: dir.to_string_lossy().to_string(),
            agents: Vec::new(),
            errors: Vec::new(),
        });
    }

    let mut agents = Vec::new();
    let mut errors = Vec::new();
    for entry in
        fs::read_dir(&dir).map_err(|e| config_error(format!("read {}: {e}", dir.display())))?
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                errors.push(config_error(format!("read agent entry: {error}")));
                continue;
            }
        };
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        match fs::read_to_string(&path)
            .map_err(|e| config_error(format!("read {}: {e}", path.display())))
            .and_then(|contents| parse_agent(&path, &contents))
        {
            Ok(agent) => agents.push(agent),
            Err(error) => errors.push(error),
        }
    }
    agents.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(AgentLoad {
        dir: dir.to_string_lossy().to_string(),
        agents,
        errors,
    })
}

#[tauri::command]
pub fn agent_write(_app: AppHandle, agent: AgentDocument) -> Result<String, String> {
    let path = agent_path(&agent.id)?;
    let contents = serialise_agent(&agent)?;
    atomic_write(&path, contents.as_bytes())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn agent_delete(_app: AppHandle, id: String) -> Result<(), String> {
    let path = agent_path(&id)?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| config_error(format!("remove {}: {e}", path.display())))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_FIXTURE: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "husk-config-test-{}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> PathBuf {
            self.0.join(CONFIG_FILE)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn example_document() -> Value {
        json!({ "config_version": 1, "preferences": { "terminalFontSize": 13, "background": { "opacity": 100, "path": "old.png" } }, "ai": { "model": "old" }, "mcp": {}, "appearance_presets": {} })
    }
    fn edit(path: &[&str], value: Value) -> ConfigPatch {
        ConfigPatch {
            path: path.iter().map(|key| (*key).to_owned()).collect(),
            value: Some(value),
        }
    }

    #[test]
    fn serialized_leaf_edits_preserve_newer_sections_and_nested_sibling_fields() {
        let fixture = Fixture::new();
        let path = fixture.path();
        write_document(&path, &example_document()).unwrap();
        patch_file(
            &path,
            &[
                edit(&["preferences", "terminalFontSize"], json!(18)),
                edit(&["preferences", "background", "opacity"], json!(60)),
            ],
        )
        .unwrap();
        let result = patch_file(
            &path,
            &[
                edit(&["ai", "model"], json!("new")),
                edit(&["preferences", "background", "path"], json!("new.png")),
            ],
        )
        .unwrap();
        assert_eq!(result["preferences"]["terminalFontSize"], 18);
        assert_eq!(
            result["preferences"]["background"],
            json!({"opacity": 60, "path": "new.png"})
        );
        assert_eq!(result["ai"]["model"], "new");
        assert_eq!(read_document(&path).unwrap(), result);
        assert_eq!(
            read_document(&backup_path(&path)).unwrap()["ai"]["model"],
            "old"
        );
    }

    #[test]
    fn migration_is_create_only_and_adopts_an_existing_document() {
        let fixture = Fixture::new();
        let path = fixture.path();
        let first = initialise_document(&path, example_document()).unwrap();
        let mut stale = example_document();
        stale["preferences"]["terminalFontSize"] = json!(99);
        assert_eq!(initialise_document(&path, stale).unwrap(), first);
        assert_eq!(read_document(&path).unwrap(), first);
    }

    #[test]
    fn malformed_and_future_config_files_are_never_replaced_by_patches_or_migration() {
        let fixture = Fixture::new();
        let path = fixture.path();
        for source in ["this is not TOML", "config_version = 999\n"] {
            fs::write(&path, source).unwrap();
            assert!(patch_file(&path, &[edit(&["ai", "model"], json!("new"))]).is_err());
            assert!(initialise_document(&path, example_document()).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), source);
            assert!(!backup_path(&path).exists());
        }
    }

    #[test]
    fn invalid_or_secret_patch_is_atomic_and_leaves_the_file_untouched() {
        let fixture = Fixture::new();
        let path = fixture.path();
        write_document(&path, &example_document()).unwrap();
        let original = fs::read(&path).unwrap();
        assert!(patch_file(
            &path,
            &[
                edit(&["preferences", "terminalFontSize"], json!(18)),
                edit(
                    &["mcp", "servers"],
                    json!([{ "env": { "API_TOKEN": "unsafe-secret" } }])
                ),
            ]
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        for invalid in [
            vec!["config_version"],
            vec!["unknown", "field"],
            vec!["preferences", "__proto__", "x"],
            vec!["preferences", ""],
        ] {
            assert!(patch_file(&path, &[edit(&invalid, json!(1))]).is_err());
            assert_eq!(fs::read(&path).unwrap(), original);
        }
    }

    #[test]
    fn optional_keys_can_be_deleted_without_removing_unrelated_data() {
        let fixture = Fixture::new();
        let path = fixture.path();
        write_document(&path, &example_document()).unwrap();
        let result = patch_file(
            &path,
            &[ConfigPatch {
                path: vec!["preferences".into(), "background".into(), "path".into()],
                value: None,
            }],
        )
        .unwrap();
        assert!(result["preferences"]["background"].get("path").is_none());
        assert_eq!(result["preferences"]["background"]["opacity"], 100);
    }

    #[test]
    fn editing_a_nested_field_repairs_only_its_malformed_container() {
        let fixture = Fixture::new();
        let path = fixture.path();
        let mut document = example_document();
        document["preferences"]["background"] = json!("invalid legacy field");
        write_document(&path, &document).unwrap();
        let result = patch_file(
            &path,
            &[edit(&["preferences", "background", "opacity"], json!(65))],
        )
        .unwrap();
        assert_eq!(
            result["preferences"]["background"],
            json!({ "opacity": 65 })
        );
        assert_eq!(result["preferences"]["terminalFontSize"], 13);
        assert_eq!(result["ai"], document["ai"]);
    }

    #[test]
    fn identical_writes_do_not_rotate_backup_and_large_configs_are_rejected() {
        let fixture = Fixture::new();
        let path = fixture.path();
        write_document(&path, &example_document()).unwrap();
        write_document(&path, &example_document()).unwrap();
        assert!(!backup_path(&path).exists());
        let mut oversized = example_document();
        oversized["preferences"]["large"] = json!("x".repeat(MAX_CONFIG_BYTES as usize));
        assert!(write_document(&path, &oversized).is_err());
        assert_eq!(read_document(&path).unwrap(), example_document());
    }

    fn example_agent() -> AgentDocument {
        AgentDocument {
            id: "reviewer".into(),
            name: "Reviewer".into(),
            icon: "🔎".into(),
            system_prompt: "Review changes for correctness and clarity.".into(),
            model: Some("gpt-5.6".into()),
            color: Some("blue".into()),
            built_in: false,
        }
    }

    #[test]
    fn agent_markdown_round_trips_without_losing_prompt_or_metadata() {
        let agent = example_agent();
        let text = serialise_agent(&agent).expect("serialize agent");
        let parsed = parse_agent(Path::new("reviewer.md"), &text).expect("parse agent");
        assert_eq!(parsed.id, agent.id);
        assert_eq!(parsed.name, agent.name);
        assert_eq!(parsed.system_prompt, agent.system_prompt);
        assert_eq!(parsed.model, agent.model);
    }

    #[test]
    fn config_rejects_plaintext_mcp_secrets() {
        let document = json!({
            "config_version": 1,
            "preferences": {},
            "ai": {},
            "appearance_presets": {},
            "mcp": {
                "servers": [{
                    "id": "github",
                    "env": { "GITHUB_TOKEN": "do-not-store-me" }
                }]
            }
        });
        assert!(validate_document(&document).is_err());
    }

    #[test]
    fn config_accepts_keychain_references_for_mcp_secrets() {
        let document = json!({
            "config_version": 1,
            "preferences": {},
            "ai": {},
            "appearance_presets": {},
            "mcp": {
                "servers": [{
                    "id": "github",
                    "env": { "GITHUB_READ_ONLY": "1" },
                    "secretEnv": { "GITHUB_TOKEN": "mcp.github.token" }
                }]
            }
        });
        assert!(validate_document(&document).is_ok());
    }
}
