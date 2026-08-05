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
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const RETENTION_DAYS: i64 = 90;

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
        let conn =
            Connection::open(db_path()?).map_err(|e| format!("cannot open timeline db: {e}"))?;
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
             CREATE INDEX IF NOT EXISTS idx_events_workspace_ts ON events (workspace_id, ts DESC);",
        )
        .map_err(|e| format!("cannot initialise timeline db: {e}"))?;
        *guard = Some(conn);
    }
    f(guard.as_ref().unwrap())
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
