//! MCP server process bridge.
//!
//! Spawns an MCP server as a child process with piped stdin/stdout and shuttles
//! JSON-RPC lines between it and the frontend (which runs the MCP SDK client
//! over a custom Tauri transport). Mirrors the husk implementation.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use tauri::State;

struct McpSession {
    child: Child,
    stdin: Arc<Mutex<std::process::ChildStdin>>,
    recv_queue: Arc<Mutex<Vec<String>>>,
}

#[derive(Default)]
pub struct McpState {
    sessions: Mutex<HashMap<u32, McpSession>>,
}

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

/// Spawn an MCP server process with piped stdin/stdout (stderr inherited).
#[tauri::command]
pub fn mcp_spawn(
    state: State<'_, McpState>,
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    cwd: Option<String>,
) -> Result<u32, String> {
    let mut cmd = Command::new(&command);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    if let Some(vars) = env {
        for (k, v) in vars {
            cmd.env(k, v);
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn '{command}': {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let stdin = child.stdin.take().ok_or("no stdin pipe")?;

    let recv_queue: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let queue_clone = Arc::clone(&recv_queue);
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    if let Ok(mut q) = queue_clone.lock() {
                        q.push(text);
                    }
                }
                Err(_) => break,
            }
        }
    });

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        McpSession {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            recv_queue,
        },
    );
    Ok(id)
}

/// Write a JSON-RPC message line to the server's stdin.
#[tauri::command]
pub fn mcp_send(state: State<'_, McpState>, id: u32, message: String) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&id).ok_or("mcp session not found")?;
    let mut stdin = session.stdin.lock().map_err(|e| e.to_string())?;
    writeln!(stdin, "{message}").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Drain up to `limit` buffered stdout lines from the server.
#[tauri::command]
pub fn mcp_recv(
    state: State<'_, McpState>,
    id: u32,
    limit: Option<usize>,
) -> Result<Vec<String>, String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&id).ok_or("mcp session not found")?;
    let mut queue = session.recv_queue.lock().map_err(|e| e.to_string())?;
    let max = limit.unwrap_or(50);
    let take = max.min(queue.len());
    Ok(queue.drain(..take).collect())
}

/// Kill an MCP server process and drop its session.
#[tauri::command]
pub fn mcp_kill(state: State<'_, McpState>, id: u32) -> Result<(), String> {
    if let Some(mut session) = state.sessions.lock().map_err(|e| e.to_string())?.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}
