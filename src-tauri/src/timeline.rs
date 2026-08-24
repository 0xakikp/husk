//! Workspace timeline — a local SQLite record of what happened in each
//! project, so returning to a repo does not mean reading a week of terminal
//! scrollback.
//!
//! Deliberate constraints:
//! - summaries and references, never full terminal output or file contents;
//! - `~/.husk/state.sqlite`, local only — nothing leaves the machine;
//! - retention is enforced on every write (default 90 days).

use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const RETENTION_DAYS: i64 = 90;
const MAX_WORKFLOW_STATE_BYTES: usize = 1024 * 1024;

pub struct TimelineState {
    conn: Mutex<Option<Connection>>,
}

impl Default for TimelineState {
    fn default() -> Self {
        Self {
            conn: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineEvent {
    pub id: i64,
    pub ts: i64,
    pub workspace_id: String,
    pub event_type: String,
    pub summary: String,
    pub metadata_json: String,
    pub sensitivity: i64,
}

fn db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("cannot resolve home directory")?;
    let dir = home.join(".husk");
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create ~/.husk: {e}"))?;
    #[cfg(unix)]
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
        .map_err(|e| format!("cannot secure ~/.husk: {e}"))?;
    Ok(dir.join("state.sqlite"))
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn with_conn<T>(
    state: &TimelineState,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.conn.lock().map_err(|_| "timeline lock poisoned")?;
    if guard.is_none() {
        let path = db_path()?;
        let conn = Connection::open(&path).map_err(|e| format!("cannot open timeline db: {e}"))?;
        #[cfg(unix)]
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("cannot secure timeline db: {e}"))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS events (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               ts INTEGER NOT NULL,
               workspace_id TEXT NOT NULL,
               event_type TEXT NOT NULL,
               summary TEXT NOT NULL,
               metadata_json TEXT NOT NULL DEFAULT '',
               sensitivity INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS idx_events_workspace_ts ON events (workspace_id, ts DESC);
             CREATE TABLE IF NOT EXISTS app_state (
               key TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );",
        )
        .map_err(|e| format!("cannot initialise timeline db: {e}"))?;
        *guard = Some(conn);
    }
    f(guard.as_ref().unwrap())
}

fn validate_workflow_state(value: &str) -> Result<(), String> {
    if value.len() > MAX_WORKFLOW_STATE_BYTES {
        return Err("workflow state is larger than 1 MiB".into());
    }
    let document: Value = serde_json::from_str(value)
        .map_err(|error| format!("workflow state is not valid JSON: {error}"))?;
    let root = document
        .as_object()
        .ok_or("workflow state must be an object")?;
    let items = root
        .get("items")
        .and_then(Value::as_array)
        .ok_or("workflow state items must be an array")?;
    if items.len() > 500 {
        return Err("workflow state contains more than 500 workflows".into());
    }
    for item in items {
        let item = item.as_object().ok_or("each workflow must be an object")?;
        let id = item.get("id").and_then(Value::as_str).unwrap_or_default();
        let name = item.get("name").and_then(Value::as_str).unwrap_or_default();
        let steps = item
            .get("steps")
            .and_then(Value::as_array)
            .ok_or("workflow steps must be an array")?;
        if id.is_empty() || id.len() > 120 || name.trim().is_empty() || name.len() > 160 {
            return Err("workflow id or name is invalid".into());
        }
        if steps.is_empty() || steps.len() > 100 {
            return Err("a workflow must contain between 1 and 100 steps".into());
        }
        if steps.iter().any(|step| {
            step.as_str()
                .is_none_or(|text| text.trim().is_empty() || text.len() > 8_000)
        }) {
            return Err(
                "workflow steps must be non-empty strings no longer than 8,000 bytes".into(),
            );
        }
    }
    if let Some(dismissed) = root.get("dismissed").and_then(Value::as_array) {
        if dismissed.len() > 100
            || dismissed
                .iter()
                .any(|value| value.as_str().is_none_or(|text| text.len() > 80))
        {
            return Err("workflow dismissal list is invalid".into());
        }
    }
    Ok(())
}

/** Workflows are durable local application state, not portable preferences.
 * Keeping them beside Timeline in ~/.husk/state.sqlite means reinstalling the
 * app does not discard them, while config.toml remains a small settings file. */
#[tauri::command]
pub fn workflow_state_load(
    state: tauri::State<'_, TimelineState>,
) -> Result<Option<String>, String> {
    with_conn(&state, |conn| {
        match conn.query_row(
            "SELECT value_json FROM app_state WHERE key = 'workflows'",
            [],
            |row| row.get::<_, String>(0),
        ) {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(format!("workflow state load failed: {error}")),
        }
    })
}

#[tauri::command]
pub fn workflow_state_save(
    state: tauri::State<'_, TimelineState>,
    value_json: String,
) -> Result<(), String> {
    validate_workflow_state(&value_json)?;
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT INTO app_state (key, value_json, updated_at) VALUES ('workflows', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![value_json, now_ts()],
        )
        .map_err(|error| format!("workflow state save failed: {error}"))?;
        Ok(())
    })
}

#[tauri::command]
pub fn timeline_record(
    state: tauri::State<'_, TimelineState>,
    workspace_id: String,
    event_type: String,
    summary: String,
    metadata_json: Option<String>,
    sensitivity: Option<i64>,
) -> Result<(), String> {
    /* Hard caps, enforced here rather than trusting callers: the timeline is
    a summary log, not a capture buffer. */
    let summary: String = summary.chars().take(240).collect();
    let metadata_json: String = metadata_json
        .unwrap_or_default()
        .chars()
        .take(2000)
        .collect();
    with_conn(&state, |conn| {
        conn.execute(
            "INSERT INTO events (ts, workspace_id, event_type, summary, metadata_json, sensitivity)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                now_ts(),
                workspace_id,
                event_type,
                summary,
                metadata_json,
                sensitivity.unwrap_or(0)
            ],
        )
        .map_err(|e| format!("timeline insert failed: {e}"))?;
        /* Retention: prune on write so the db never grows without bound. */
        let cutoff = now_ts() - RETENTION_DAYS * 86_400;
        conn.execute("DELETE FROM events WHERE ts < ?1", params![cutoff])
            .map_err(|e| format!("timeline prune failed: {e}"))?;
        Ok(())
    })
}

#[tauri::command]
pub fn timeline_query(
    state: tauri::State<'_, TimelineState>,
    workspace_id: String,
    event_types: Vec<String>,
    since_days: Option<u32>,
    limit: Option<u32>,
) -> Result<Vec<TimelineEvent>, String> {
    let since_ts = now_ts() - (since_days.unwrap_or(30).max(1) as i64) * 86_400;
    let limit = limit.unwrap_or(200).clamp(1, 1000) as i64;
    with_conn(&state, |conn| {
        let mut sql = String::from(
            "SELECT id, ts, workspace_id, event_type, summary, metadata_json, sensitivity
             FROM events WHERE workspace_id = ?1 AND ts >= ?2",
        );
        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> =
            vec![Box::new(workspace_id), Box::new(since_ts)];
        if !event_types.is_empty() {
            let placeholders = event_types
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");
            sql.push_str(&format!(" AND event_type IN ({placeholders})"));
            for t in &event_types {
                values.push(Box::new(t.clone()));
            }
        }
        sql.push_str(" ORDER BY ts DESC LIMIT ?");
        values.push(Box::new(limit));

        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("timeline query failed: {e}"))?;
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|v| v.as_ref()).collect();
        let rows = stmt
            .query_map(params_ref.as_slice(), |row| {
                Ok(TimelineEvent {
                    id: row.get(0)?,
                    ts: row.get(1)?,
                    workspace_id: row.get(2)?,
                    event_type: row.get(3)?,
                    summary: row.get(4)?,
                    metadata_json: row.get(5)?,
                    sensitivity: row.get(6)?,
                })
            })
            .map_err(|e| format!("timeline query failed: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("timeline row failed: {e}"))?);
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn timeline_clear(
    state: tauri::State<'_, TimelineState>,
    workspace_id: String,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute(
            "DELETE FROM events WHERE workspace_id = ?1",
            params![workspace_id],
        )
        .map_err(|e| format!("timeline clear failed: {e}"))?;
        Ok(())
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineWorkspace {
    pub workspace_id: String,
    pub event_count: i64,
    pub last_ts: i64,
}

#[tauri::command]
pub fn timeline_workspaces(
    state: tauri::State<'_, TimelineState>,
) -> Result<Vec<TimelineWorkspace>, String> {
    /* Every bucket that has events, most recent first — the header folder
    switcher lets the user peek at another project's timeline without
    cd-ing there. */
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT workspace_id, COUNT(*) AS n, MAX(ts) AS last
                 FROM events GROUP BY workspace_id ORDER BY last DESC",
            )
            .map_err(|e| format!("timeline workspaces failed: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TimelineWorkspace {
                    workspace_id: row.get(0)?,
                    event_count: row.get(1)?,
                    last_ts: row.get(2)?,
                })
            })
            .map_err(|e| format!("timeline workspaces failed: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("timeline workspace row failed: {e}"))?);
        }
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::validate_workflow_state;

    #[test]
    fn workflow_state_accepts_bounded_reviewable_steps() {
        let value = r#"{"items":[{"id":"wf_1","name":"Checks","steps":["pnpm lint","pnpm test"],"stopOnError":true}],"dismissed":[]}"#;
        assert!(validate_workflow_state(value).is_ok());
    }

    #[test]
    fn workflow_state_rejects_empty_and_unbounded_shapes() {
        assert!(
            validate_workflow_state(r#"{"items":[{"id":"wf_1","name":"Checks","steps":[]}]}"#)
                .is_err()
        );
        assert!(validate_workflow_state(r#"{"items":"not-an-array"}"#).is_err());
    }
}
