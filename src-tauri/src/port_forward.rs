use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::str::FromStr;
use std::thread;
use std::io::{Read, Write};
use serde::{Deserialize, Serialize};

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
    #[allow(dead_code)]
    config: PortForwardConfig,
    abort: std::sync::mpsc::Sender<()>,
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
        let mut forwards = state.forwards.lock().unwrap();
        if let Some(existing) = forwards.remove(&config.id) {
            let _ = existing.abort.send(());
        }
    }

    let (abort_tx, abort_rx) = std::sync::mpsc::channel::<()>();

    let config_clone = config.clone();
    let forwards = state.forwards.clone();
    let id = config.id.clone();

    thread::spawn(move || {
        let result = run_forward(config_clone, abort_rx);
        let mut forwards = forwards.lock().unwrap();
        forwards.remove(&id);
        if let Err(e) = result {
            eprintln!("Port forward {} error: {}", id, e);
        }
    });

    {
        let mut forwards = state.forwards.lock().unwrap();
        forwards.insert(
            config.id.clone(),
            ForwardHandle {
                config: config.clone(),
                abort: abort_tx,
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
    let mut forwards = state.forwards.lock().unwrap();
    if let Some(handle) = forwards.remove(&id) {
        let _ = handle.abort.send(());
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
pub fn port_forward_list(
    state: tauri::State<'_, PortForwardManager>,
) -> Vec<PortForwardStatus> {
    let forwards = state.forwards.lock().unwrap();
    forwards
        .values()
        .map(|h| PortForwardStatus {
            id: h.config.id.clone(),
            active: true,
            error: None,
        })
        .collect()
}

fn run_forward(
    config: PortForwardConfig,
    abort: std::sync::mpsc::Receiver<()>,
) -> Result<(), String> {
    match config.forward_type.as_str() {
        "local" => run_local_forward(config, abort),
        "remote" => run_remote_forward(config, abort),
        "dynamic" => run_dynamic_forward(config, abort),
        _ => Err(format!("Unknown forward type: {}", config.forward_type)),
    }
}

fn run_local_forward(
    config: PortForwardConfig,
    abort: std::sync::mpsc::Receiver<()>,
) -> Result<(), String> {
    let local_addr = SocketAddr::from_str(&format!("127.0.0.1:{}", config.local_port))
        .map_err(|e| format!("Invalid local address: {}", e))?;

    let listener = TcpListener::bind(local_addr)
        .map_err(|e| format!("Failed to bind local port: {}", e))?;
    listener.set_nonblocking(true)
        .map_err(|e| format!("Failed to set nonblocking: {}", e))?;

    let remote_host = config.remote_host.clone().unwrap_or_else(|| "localhost".to_string());
    let remote_port = config.remote_port.unwrap_or(0);

    loop {
        // Check for abort
        if abort.try_recv().is_ok() {
            return Ok(());
        }

        match listener.accept() {
            Ok((local_stream, _)) => {
                let remote_host = remote_host.clone();
                thread::spawn(move || {
                    let _ = handle_local_forward_connection(
                        local_stream,
                        remote_host,
                        remote_port,
                    );
                });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => {
                eprintln!("Local forward accept error: {}", e);
            }
        }
    }
}

fn handle_local_forward_connection(
    mut local_stream: TcpStream,
    remote_host: String,
    remote_port: u16,
) -> Result<(), String> {
    // For simplified implementation, connect directly to remote destination
    // Full SSH tunneling would require complete russh client with auth
    let mut remote_stream = TcpStream::connect(format!("{}:{}", remote_host, remote_port))
        .map_err(|e| format!("Failed to connect to remote destination: {}", e))?;

    // Bidirectional copy
    let mut local_clone = local_stream.try_clone()
        .map_err(|e| e.to_string())?;
    let mut remote_clone = remote_stream.try_clone()
        .map_err(|e| e.to_string())?;

    let local_to_remote = thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match local_clone.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if remote_stream.write_all(&buf[..n]).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let mut buf = [0u8; 8192];
    loop {
        match remote_clone.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if local_stream.write_all(&buf[..n]).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    let _ = local_to_remote.join();
    Ok(())
}

fn run_remote_forward(
    _config: PortForwardConfig,
    _abort: std::sync::mpsc::Receiver<()>,
) -> Result<(), String> {
    // Remote forwarding requires SSH server to open a port on the remote side
    Err("Remote forwarding not yet implemented".to_string())
}

fn run_dynamic_forward(
    config: PortForwardConfig,
    abort: std::sync::mpsc::Receiver<()>,
) -> Result<(), String> {
    let local_addr = SocketAddr::from_str(&format!("127.0.0.1:{}", config.local_port))
        .map_err(|e| format!("Invalid local address: {}", e))?;

    let listener = TcpListener::bind(local_addr)
        .map_err(|e| format!("Failed to bind local port: {}", e))?;
    listener.set_nonblocking(true)
        .map_err(|e| format!("Failed to set nonblocking: {}", e))?;

    loop {
        // Check for abort
        if abort.try_recv().is_ok() {
            return Ok(());
        }

        match listener.accept() {
            Ok((local_stream, _)) => {
                thread::spawn(move || {
                    let _ = handle_socks5_connection(local_stream);
                });
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => {
                eprintln!("SOCKS5 accept error: {}", e);
            }
        }
    }
}

fn handle_socks5_connection(
    mut local_stream: TcpStream,
) -> Result<(), String> {
    // Read SOCKS5 greeting
    let mut buf = [0u8; 2];
    local_stream.read_exact(&mut buf).map_err(|e| e.to_string())?;
    let nmethods = buf[1] as usize;
    let mut methods = vec![0u8; nmethods];
    local_stream.read_exact(&mut methods).map_err(|e| e.to_string())?;

    // Send response - accept no auth (0x00)
    local_stream.write_all(&[0x05, 0x00]).map_err(|e| e.to_string())?;

    // Read request
    let mut req = [0u8; 4];
    local_stream.read_exact(&mut req).map_err(|e| e.to_string())?;

    let cmd = req[1];
    let atyp = req[3];

    if cmd != 0x01 {
        // CONNECT only
        local_stream.write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).ok();
        return Err("SOCKS5 command not supported".to_string());
    }

    let target_addr = match atyp {
        0x01 => {
            // IPv4
            let mut ip = [0u8; 4];
            local_stream.read_exact(&mut ip).map_err(|e| e.to_string())?;
            let mut port = [0u8; 2];
            local_stream.read_exact(&mut port).map_err(|e| e.to_string())?;
            let port = u16::from_be_bytes(port);
            format!("{}.{}.{}.{}:{}", ip[0], ip[1], ip[2], ip[3], port)
        }
        0x03 => {
            // Domain
            let mut len = [0u8; 1];
            local_stream.read_exact(&mut len).map_err(|e| e.to_string())?;
            let mut domain = vec![0u8; len[0] as usize];
            local_stream.read_exact(&mut domain).map_err(|e| e.to_string())?;
            let mut port = [0u8; 2];
            local_stream.read_exact(&mut port).map_err(|e| e.to_string())?;
            let port = u16::from_be_bytes(port);
            format!("{}:{}", String::from_utf8_lossy(&domain), port)
        }
        _ => {
            local_stream.write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).ok();
            return Err("SOCKS5 address type not supported".to_string());
        }
    };

    // Connect to target directly (simplified - no SSH tunnel yet)
    match TcpStream::connect(&target_addr) {
        Ok(mut remote_stream) => {
            // Send success response
            local_stream.write_all(&[0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]).ok();

            let mut local_clone = local_stream.try_clone().unwrap();
            let mut remote_clone = remote_stream.try_clone().unwrap();

            let local_to_remote = thread::spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match local_clone.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if remote_stream.write_all(&buf[..n]).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            });

            let mut buf = [0u8; 8192];
            loop {
                match remote_clone.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if local_stream.write_all(&buf[..n]).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }

            let _ = local_to_remote.join();
        }
        Err(_) => {
            local_stream.write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).ok();
        }
    }

    Ok(())
}
