use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::{Command, Stdio};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

/// Lock a mutex, recovering from poison if a previous thread panicked.
/// This prevents cascading panics when one thread dies while holding a lock.
fn lock_forwards(
    m: &Mutex<HashMap<String, ForwardHandle>>,
) -> std::sync::MutexGuard<HashMap<String, ForwardHandle>> {
    match m.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            let guard = poisoned.into_inner();
            eprintln!(
                "PortForwardManager mutex was poisoned, recovered {} entries",
                guard.len()
            );
            guard
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardConfig {
    pub id: String,
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
    pub forward_type: String,
    pub local_port: u16,
    pub remote_host: Option<String>,
    pub remote_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortForwardStatus {
    pub id: String,
    pub active: bool,
    pub error: Option<String>,
}

struct ForwardHandle {
    config: PortForwardConfig,
    abort: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct PortForwardManager {
    forwards: Arc<Mutex<HashMap<String, ForwardHandle>>>,
}

impl PortForwardManager {
    pub fn new() -> Self {
        Self {
            forwards: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
pub fn port_forward_start(
    state: tauri::State<'_, PortForwardManager>,
    config: PortForwardConfig,
) -> Result<PortForwardStatus, String> {
    // Stop existing forward with same ID if any
    {
        let mut forwards = lock_forwards(&state.forwards);
        if let Some(existing) = forwards.remove(&config.id) {
            existing.abort.store(true, Ordering::Relaxed);
        }
    }

    let abort = Arc::new(AtomicBool::new(false));
    let config_clone = config.clone();
    let forwards = state.forwards.clone();
    let id = config.id.clone();
    let abort_clone = abort.clone();

    thread::spawn(move || {
        let result = run_forward(config_clone, abort_clone);
        let mut forwards = lock_forwards(&forwards);
        forwards.remove(&id);
        if let Err(e) = result {
            eprintln!("Port forward {} error: {}", id, e);
        }
    });

    {
        let mut forwards = lock_forwards(&state.forwards);
        forwards.insert(
            config.id.clone(),
            ForwardHandle {
                config: config.clone(),
                abort: abort.clone(),
            },
        );
    }

    Ok(PortForwardStatus {
        id: config.id,
        active: true,
        error: None,
    })
}

#[tauri::command]
pub fn port_forward_stop(
    state: tauri::State<'_, PortForwardManager>,
    id: String,
) -> Result<PortForwardStatus, String> {
    let mut forwards = lock_forwards(&state.forwards);
    if let Some(handle) = forwards.remove(&id) {
        handle.abort.store(true, Ordering::Relaxed);
        Ok(PortForwardStatus {
            id,
            active: false,
            error: None,
        })
    } else {
        Err("Forward not found".to_string())
    }
}

#[tauri::command]
pub fn port_forward_list(state: tauri::State<'_, PortForwardManager>) -> Vec<PortForwardStatus> {
    let forwards = lock_forwards(&state.forwards);
    forwards
        .values()
        .map(|h| PortForwardStatus {
            id: h.config.id.clone(),
            active: true,
            error: None,
        })
        .collect()
}

fn run_forward(config: PortForwardConfig, abort: Arc<AtomicBool>) -> Result<(), String> {
    match config.forward_type.as_str() {
        "local" => run_local_forward(config, abort),
        "remote" => run_remote_forward(config, abort),
        "dynamic" => run_dynamic_forward(config, abort),
        _ => Err(format!("Unknown forward type: {}", config.forward_type)),
    }
}

fn build_ssh_args(config: &PortForwardConfig) -> Vec<String> {
    let mut args = vec![
        "-o".to_string(),
        "BatchMode=no".to_string(),
        "-o".to_string(),
        "ServerAliveInterval=30".to_string(),
        "-o".to_string(),
        "ServerAliveCountMax=3".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
        "-p".to_string(),
        config.port.to_string(),
    ];

    if let Some(key_path) = &config.private_key_path {
        args.push("-i".to_string());
        args.push(key_path.clone());
    }

    if !config.user.is_empty() {
        args.push(format!("{}@{}", config.user, config.host));
    } else {
        args.push(config.host.clone());
    }

    args
}

fn run_local_forward(config: PortForwardConfig, abort: Arc<AtomicBool>) -> Result<(), String> {
    let local_addr = SocketAddr::from_str(&format!("127.0.0.1:{}", config.local_port))
        .map_err(|e| format!("Invalid local address: {}", e))?;

    let listener =
        TcpListener::bind(local_addr).map_err(|e| format!("Failed to bind local port: {}", e))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to set nonblocking: {}", e))?;

    let remote_host = config
        .remote_host
        .clone()
        .unwrap_or_else(|| "localhost".to_string());
    let remote_port = config.remote_port.unwrap_or(0);

    loop {
        if abort.load(Ordering::Relaxed) {
            return Ok(());
        }

        match listener.accept() {
            Ok((local_stream, _)) => {
                let mut ssh_args = build_ssh_args(&config);
                ssh_args.push("-L".to_string());
                ssh_args.push(format!(
                    "{}:{}:{}",
                    config.local_port, remote_host, remote_port
                ));
                ssh_args.push("-N".to_string()); // No command execution
                let abort_clone = abort.clone();

                thread::spawn(move || {
                    let _ = handle_ssh_forward_connection(local_stream, ssh_args, abort_clone);
                });
            }
            Err(e) => {
                eprintln!("Local forward accept error: {}", e);
            }
        }
    }
}

fn handle_ssh_forward_connection(
    mut local_stream: TcpStream,
    ssh_args: Vec<String>,
    abort: Arc<AtomicBool>,
) -> Result<(), String> {
    // Spawn SSH process with port forwarding
    let mut cmd = Command::new("ssh");
    cmd.args(&ssh_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn SSH: {}", e))?;

    // Wait for abort or connection close
    loop {
        if abort.load(Ordering::Relaxed) {
            let _ = child.kill();
            return Ok(());
        }

        // Check if connection is still alive
        let mut buf = [0u8; 1];
        match local_stream.read(&mut buf) {
            Ok(0) => {
                let _ = child.kill();
                return Ok(());
            }
            Ok(_) => {
                // Data available, but we're just monitoring
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(_) => {
                let _ = child.kill();
                return Ok(());
            }
        }
    }
}

fn run_remote_forward(config: PortForwardConfig, abort: Arc<AtomicBool>) -> Result<(), String> {
    let remote_host = config
        .remote_host
        .clone()
        .unwrap_or_else(|| "localhost".to_string());
    let remote_port = config.remote_port.unwrap_or(0);

    let mut ssh_args = build_ssh_args(&config);
    ssh_args.push("-R".to_string());
    ssh_args.push(format!(
        "{}:{}:{}",
        config.local_port, remote_host, remote_port
    ));
    ssh_args.push("-N".to_string());

    let mut cmd = Command::new("ssh");
    cmd.args(&ssh_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn SSH: {}", e))?;

    // Wait for abort
    while !abort.load(Ordering::Relaxed) {
        thread::sleep(std::time::Duration::from_millis(500));

        // Check if child exited
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err(format!(
                        "SSH remote forward exited with code: {:?}",
                        status.code()
                    ));
                }
                return Ok(());
            }
            Ok(None) => continue,
            Err(e) => return Err(format!("Failed to check SSH status: {}", e)),
        }
    }

    let _ = child.kill();
    Ok(())
}

fn run_dynamic_forward(config: PortForwardConfig, abort: Arc<AtomicBool>) -> Result<(), String> {
    let mut ssh_args = build_ssh_args(&config);
    ssh_args.push("-D".to_string());
    ssh_args.push(format!("127.0.0.1:{}", config.local_port));
    ssh_args.push("-N".to_string());

    let mut cmd = Command::new("ssh");
    cmd.args(&ssh_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn SSH: {}", e))?;

    // Wait for abort
    while !abort.load(Ordering::Relaxed) {
        thread::sleep(std::time::Duration::from_millis(500));

        // Check if child exited
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err(format!(
                        "SSH dynamic forward exited with code: {:?}",
                        status.code()
                    ));
                }
                return Ok(());
            }
            Ok(None) => continue,
            Err(e) => return Err(format!("Failed to check SSH status: {}", e)),
        }
    }

    let _ = child.kill();
    Ok(())
}
