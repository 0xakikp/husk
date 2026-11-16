use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Lock a mutex, recovering from poison if a previous thread panicked.
/// This prevents cascading panics when one thread dies while holding a lock.
fn lock_forwards(
    m: &Mutex<HashMap<String, ForwardHandle>>,
) -> std::sync::MutexGuard<'_, HashMap<String, ForwardHandle>> {
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

impl Drop for PortForwardManager {
    fn drop(&mut self) {
        for handle in lock_forwards(&self.forwards).values() {
            handle.abort.store(true, Ordering::Release);
        }
    }
}

fn remove_if_current(
    forwards: &Mutex<HashMap<String, ForwardHandle>>,
    id: &str,
    abort: &Arc<AtomicBool>,
) {
    let mut forwards = lock_forwards(forwards);
    if forwards
        .get(id)
        .is_some_and(|handle| Arc::ptr_eq(&handle.abort, abort))
    {
        forwards.remove(id);
    }
}

#[tauri::command]
pub fn port_forward_start(
    state: tauri::State<'_, PortForwardManager>,
    config: PortForwardConfig,
) -> Result<PortForwardStatus, String> {
    // Validate before replacing an existing working tunnel.
    let ssh_args = build_ssh_args(&config)?;

    let abort = Arc::new(AtomicBool::new(false));
    let id = config.id.clone();
    {
        let mut forwards = lock_forwards(&state.forwards);
        if let Some(existing) = forwards.insert(
            id.clone(),
            ForwardHandle {
                config: config.clone(),
                abort: abort.clone(),
            },
        ) {
            existing.abort.store(true, Ordering::Release);
        }
    }

    let worker_forwards = state.forwards.clone();
    let worker_id = id.clone();
    let worker_abort = abort.clone();
    if let Err(error) = thread::Builder::new()
        .name("husk-port-forward".into())
        .spawn(move || {
            let result = run_ssh_forward(ssh_args, worker_abort.clone());
            remove_if_current(&worker_forwards, &worker_id, &worker_abort);
            if let Err(error) = result {
                eprintln!("Port forward {worker_id} error: {error}");
            }
        })
    {
        remove_if_current(&state.forwards, &id, &abort);
        return Err(format!("Could not start port forward worker: {error}"));
    }

    Ok(PortForwardStatus {
        id,
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
        handle.abort.store(true, Ordering::Release);
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

fn build_ssh_args(config: &PortForwardConfig) -> Result<Vec<String>, String> {
    if config.auth_type == "password" {
        return Err("Port forwarding uses non-interactive SSH; password profiles are not supported. Use SSH agent or an unlocked key.".into());
    }
    if config.id.is_empty() || config.host.is_empty() || config.host.starts_with('-') {
        return Err("Port forward requires an ID and a valid SSH host.".into());
    }
    if config.port == 0 || config.local_port == 0 {
        return Err("Port forward requires nonzero SSH and local ports.".into());
    }
    if config.user.starts_with('-') {
        return Err("Invalid SSH user for port forward.".into());
    }
    let mut args = vec![
        "-o".to_string(),
        // The process has no interactive stdin; do not hang waiting for a
        // password prompt that the user cannot answer here.
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "ExitOnForwardFailure=yes".to_string(),
        "-o".to_string(),
        "ConnectTimeout=10".to_string(),
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
    args.push("-N".to_string());
    match config.forward_type.as_str() {
        "local" => {
            let remote_port = config
                .remote_port
                .filter(|port| *port != 0)
                .ok_or("Local forward requires a remote port.")?;
            let remote_host = config
                .remote_host
                .as_deref()
                .filter(|host| !host.is_empty())
                .unwrap_or("localhost");
            args.push("-L".to_string());
            args.push(format!(
                "127.0.0.1:{}:{remote_host}:{remote_port}",
                config.local_port
            ));
        }
        "remote" => {
            let remote_port = config
                .remote_port
                .filter(|port| *port != 0)
                .ok_or("Remote forward requires a remote port.")?;
            let remote_host = config
                .remote_host
                .as_deref()
                .filter(|host| !host.is_empty())
                .unwrap_or("127.0.0.1");
            args.push("-R".to_string());
            args.push(format!(
                "{remote_host}:{remote_port}:127.0.0.1:{}",
                config.local_port
            ));
        }
        "dynamic" => {
            args.push("-D".to_string());
            args.push(format!("127.0.0.1:{}", config.local_port));
        }
        _ => return Err(format!("Unknown forward type: {}", config.forward_type)),
    }
    args.push(if config.user.is_empty() {
        config.host.clone()
    } else {
        format!("{}@{}", config.user, config.host)
    });
    Ok(args)
}

fn run_ssh_forward(ssh_args: Vec<String>, abort: Arc<AtomicBool>) -> Result<(), String> {
    let mut cmd = Command::new("ssh");
    cmd.args(&ssh_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn SSH: {}", e))?;

    loop {
        if abort.load(Ordering::Acquire) {
            let _ = child.kill();
            let _ = child.wait();
            return Ok(());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err(format!(
                        "SSH port forward exited with code: {:?}",
                        status.code()
                    ));
                }
                return Ok(());
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(format!("Failed to check SSH status: {}", e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(forward_type: &str) -> PortForwardConfig {
        PortForwardConfig {
            id: "fixture".into(),
            connection_id: "connection".into(),
            host: "example.test".into(),
            port: 22,
            user: "alice".into(),
            auth_type: "key".into(),
            password: None,
            private_key_path: None,
            passphrase: None,
            forward_type: forward_type.into(),
            local_port: 8080,
            remote_host: Some("db.internal".into()),
            remote_port: Some(5432),
        }
    }

    #[test]
    fn local_forward_lets_ssh_own_the_listener_and_destination_is_last() {
        let args = build_ssh_args(&config("local")).unwrap();
        assert_eq!(args.last().map(String::as_str), Some("alice@example.test"));
        assert_eq!(
            args.windows(2)
                .find(|pair| pair[0] == "-L")
                .map(|pair| pair[1].as_str()),
            Some("127.0.0.1:8080:db.internal:5432")
        );
        assert!(args.contains(&"ExitOnForwardFailure=yes".to_string()));
        assert!(args.contains(&"BatchMode=yes".to_string()));
    }

    #[test]
    fn remote_and_dynamic_forward_use_correct_ports() {
        let args = build_ssh_args(&config("remote")).unwrap();
        assert_eq!(
            args.windows(2)
                .find(|pair| pair[0] == "-R")
                .map(|pair| pair[1].as_str()),
            Some("db.internal:5432:127.0.0.1:8080")
        );
        let args = build_ssh_args(&config("dynamic")).unwrap();
        assert_eq!(
            args.windows(2)
                .find(|pair| pair[0] == "-D")
                .map(|pair| pair[1].as_str()),
            Some("127.0.0.1:8080")
        );
    }

    #[test]
    fn invalid_forward_does_not_start_or_replace_a_tunnel() {
        let mut invalid = config("local");
        invalid.remote_port = None;
        assert!(build_ssh_args(&invalid).is_err());
        invalid = config("unexpected");
        assert!(build_ssh_args(&invalid).is_err());
        invalid = config("dynamic");
        invalid.host = "-oProxyCommand=bad".into();
        assert!(build_ssh_args(&invalid).is_err());
        invalid = config("dynamic");
        invalid.auth_type = "password".into();
        assert!(build_ssh_args(&invalid).unwrap_err().contains("SSH agent"));
    }

    #[test]
    fn an_old_worker_cannot_remove_its_replacement() {
        let manager = PortForwardManager::new();
        let old_abort = Arc::new(AtomicBool::new(false));
        let new_abort = Arc::new(AtomicBool::new(false));
        lock_forwards(&manager.forwards).insert(
            "fixture".into(),
            ForwardHandle {
                config: config("local"),
                abort: new_abort.clone(),
            },
        );
        remove_if_current(&manager.forwards, "fixture", &old_abort);
        assert_eq!(lock_forwards(&manager.forwards).len(), 1);
        remove_if_current(&manager.forwards, "fixture", &new_abort);
        assert!(lock_forwards(&manager.forwards).is_empty());
    }
}
