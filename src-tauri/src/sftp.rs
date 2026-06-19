//! SFTP file transfer using russh + russh-sftp (pure-Rust SSH).
//! Replaces ssh2/libssh2 which doesn't support modern OpenSSH key exchange algorithms.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

use russh::client;
use russh::client::AuthResult;
use russh::keys::*;
use russh::Disconnect;
use russh_sftp::client::SftpSession;
use tauri::{AppHandle, Emitter, State};

/// SSH client handler (required by russh, minimal implementation).
pub struct SshClient;

impl client::Handler for SshClient {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        async move { Ok(true) }
    }
}

/// Connection info for caching.
struct Connection {
    #[allow(dead_code)]
    session: client::Handle<SshClient>,
    sftp: SftpSession,
}

/// Shared SFTP session manager using russh.
#[derive(Clone)]
pub struct SftpManager {
    connections: Arc<Mutex<HashMap<String, Connection>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Resolve SSH host via `ssh -G` and ~/.ssh/config.
    fn resolve_host(host: &str) -> (String, u16, String, Vec<String>) {
        let mut hostname: Option<String> = None;
        let mut port: Option<u16> = None;
        let mut user: Option<String> = None;
        let mut identity_files: Vec<String> = Vec::new();

        // Try ssh -G first
        if let Ok(out) = std::process::Command::new("ssh").args(["-G", host]).output() {
            if out.status.success() {
                for line in String::from_utf8_lossy(&out.stdout).lines() {
                    let lower = line.to_lowercase();
                    if lower.starts_with("hostname ") {
                        if let Some(h) = line.split_whitespace().nth(1) {
                            if h != host {
                                hostname = Some(h.to_string());
                            }
                        }
                    } else if lower.starts_with("port ") {
                        if let Some(p) = line.split_whitespace().nth(1) {
                            port = p.parse().ok();
                        }
                    } else if lower.starts_with("user ") {
                        if let Some(u) = line.split_whitespace().nth(1) {
                            user = Some(u.to_string());
                        }
                    } else if lower.starts_with("identityfile ") {
                        if let Some(f) = line.split_whitespace().nth(1) {
                            identity_files.push(f.to_string());
                        }
                    }
                }
            }
        }

        // Fallback: parse ~/.ssh/config manually
        if hostname.is_none() || port.is_none() {
            let home = dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let config_path = format!("{}/.ssh/config", home);
            let content = std::fs::read_to_string(&config_path).unwrap_or_default();

            let mut current_hosts: Vec<String> = Vec::new();
            let mut host_map: HashMap<String, (String, u16, String)> = HashMap::new();

            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if trimmed.to_lowercase().starts_with("host ") {
                    current_hosts = trimmed
                        .split_whitespace()
                        .skip(1)
                        .map(|s| s.to_string())
                        .collect();
                } else if !current_hosts.is_empty() {
                    let lower = trimmed.to_lowercase();
                    if lower.starts_with("hostname ") {
                        if let Some(h) = trimmed.split_whitespace().nth(1) {
                            for ch in &current_hosts {
                                if !ch.contains('*') {
                                    host_map
                                        .entry(ch.clone())
                                        .and_modify(|e| e.0 = h.to_string())
                                        .or_insert((h.to_string(), 22, user.clone().unwrap_or_default()));
                                }
                            }
                        }
                    } else if lower.starts_with("port ") {
                        if let Some(p) = trimmed.split_whitespace().nth(1) {
                            if let Ok(port_num) = p.parse::<u16>() {
                                for ch in &current_hosts {
                                    if !ch.contains('*') {
                                        host_map
                                            .entry(ch.clone())
                                            .and_modify(|e| e.1 = port_num)
                                            .or_insert((host.to_string(), port_num, user.clone().unwrap_or_default()));
                                    }
                                }
                            }
                        }
                    } else if lower.starts_with("user ") {
                        if let Some(u) = trimmed.split_whitespace().nth(1) {
                            for ch in &current_hosts {
                                if !ch.contains('*') {
                                    host_map
                                        .entry(ch.clone())
                                        .and_modify(|e| e.2 = u.to_string())
                                        .or_insert((host.to_string(), 22, u.to_string()));
                                }
                            }
                        }
                    }
                }
            }

            if let Some((h, p, u)) = host_map.get(host) {
                hostname = Some(h.clone());
                port = Some(*p);
                if user.is_none() {
                    user = Some(u.clone());
                }
            }
        }

        let hostname = hostname.unwrap_or_else(|| host.to_string());
        let port = port.unwrap_or(22);
        let user = user.unwrap_or_else(|| whoami::username().unwrap_or_else(|_| "root".to_string()));

        if identity_files.is_empty() {
            identity_files.push("~/.ssh/id_rsa".to_string());
            identity_files.push("~/.ssh/id_ed25519".to_string());
        }

        (hostname, port, user, identity_files)
    }

    /// Connect or return cached connection.
    pub async fn connect(&self, host: &str) -> Result<(), String> {
        let mut conns = self.connections.lock().await;
        if conns.contains_key(host) {
            return Ok(());
        }

        let (actual_host, port, username, identity_files) = Self::resolve_host(host);

        let config = client::Config::default();
        let config = Arc::new(config);

        let addr: SocketAddr = format!("{}:{}", actual_host, port)
            .parse()
            .map_err(|e| format!("Invalid address: {}", e))?;

        let mut session = client::connect(config, addr, SshClient)
            .await
            .map_err(|e| format!("SSH connect failed: {}", e))?;

        // Try public key authentication first
        let mut authenticated = false;
        for key_path in identity_files {
            let expanded = shellexpand::tilde(&key_path).to_string();
            if std::path::Path::new(&expanded).exists() {
                let secret_key = load_secret_key(&expanded, None)
                    .map_err(|e| format!("Failed to load key {}: {}", expanded, e))?;
                let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(secret_key), None);
                match session.authenticate_publickey(&username, key_with_hash).await {
                    Ok(AuthResult::Success) => {
                        authenticated = true;
                        break;
                    }
                    Ok(_) => continue,
                    Err(e) => {
                        eprintln!("Auth error for {}: {}", expanded, e);
                        continue;
                    }
                }
            }
        }

        if !authenticated {
            return Err(
                "SSH authentication failed. Ensure your key is in ssh-agent, or add IdentityFile to ~/.ssh/config"
                    .to_string(),
            );
        }

        // Open SFTP channel
        let channel = session
            .channel_open_session()
            .await
            .map_err(|e| format!("Channel open failed: {}", e))?;

        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("SFTP subsystem failed: {}", e))?;

        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| format!("SFTP session failed: {}", e))?;

        conns.insert(host.to_string(), Connection { session, sftp });
        Ok(())
    }

    /// Disconnect and remove a host.
    pub async fn disconnect(&self, host: &str) {
        let mut conns = self.connections.lock().await;
        if let Some(conn) = conns.remove(host) {
            let _ = conn.sftp.close().await;
            let _ = conn.session.disconnect(Disconnect::ByApplication, "Closed", "English").await;
        }
    }
}

impl Default for SftpManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Entry in a directory listing.
#[derive(serde::Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

#[tauri::command]
pub async fn sftp_connect(
    host: String,
    manager: State<'_, SftpManager>,
) -> Result<bool, String> {
    manager.connect(&host).await.map(|_| true)
}

#[tauri::command]
pub async fn sftp_disconnect(
    host: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    manager.disconnect(&host).await;
    Ok(())
}

#[tauri::command]
pub async fn sftp_list_dir(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<Vec<SftpEntry>, String> {
    let mut conns = manager.connections.lock().await;
    let conn = conns
        .get_mut(&host)
        .ok_or_else(|| "Not connected".to_string())?;

    let entries = conn
        .sftp
        .read_dir(&path)
        .await
        .map_err(|e| format!("SFTP readdir failed: {}", e))?;

    let mut result = Vec::new();
    for entry in entries {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let entry_path = if path == "/" {
            format!("/{}", name)
        } else {
            format!("{}/{}", path, name)
        };
        let meta = entry.metadata();
        result.push(SftpEntry {
            name,
            path: entry_path,
            is_dir: meta.file_type().is_dir(),
            size: meta.len(),
            modified: meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())),
        });
    }

    result.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    host: String,
    remote_path: String,
    local_path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let mut conns = manager.connections.lock().await;
    let conn = conns
        .get_mut(&host)
        .ok_or_else(|| "Not connected".to_string())?;

    let meta = conn
        .sftp
        .metadata(&remote_path)
        .await
        .map_err(|e| format!("SFTP stat failed: {}", e))?;
    let total_size = meta.len();

    let mut remote = conn
        .sftp
        .open(&remote_path)
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?;

    let mut local = tokio::fs::File::create(&local_path)
        .await
        .map_err(|e| format!("Local file create failed: {}", e))?;

    let mut copied = 0u64;
    let mut buf = vec![0u8; 65536];
    loop {
        let n = remote
            .read(&mut buf)
            .await
            .map_err(|e| format!("SFTP read failed: {}", e))?;
        if n == 0 {
            break;
        }
        local
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("Local write failed: {}", e))?;
        copied += n as u64;

        if total_size > 0 {
            let progress = ((copied as f64 / total_size as f64) * 100.0) as u32;
            let _ = app.emit(
                &format!("sftp://progress/{}", host),
                serde_json::json!({
                    "type": "download",
                    "path": remote_path,
                    "progress": progress,
                    "copied": copied,
                    "total": total_size,
                }),
            );
        }
    }

    let _ = app.emit(
        &format!("sftp://progress/{}", host),
        serde_json::json!({
            "type": "download",
            "path": remote_path,
            "progress": 100,
            "done": true,
        }),
    );

    Ok(())
}

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    host: String,
    local_path: String,
    remote_path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let mut conns = manager.connections.lock().await;
    let conn = conns
        .get_mut(&host)
        .ok_or_else(|| "Not connected".to_string())?;

    let total_size = tokio::fs::metadata(&local_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let mut local = tokio::fs::File::open(&local_path)
        .await
        .map_err(|e| format!("Local file open failed: {}", e))?;

    let mut remote = conn
        .sftp
        .create(&remote_path)
        .await
        .map_err(|e| format!("SFTP create failed: {}", e))?;

    let mut copied = 0u64;
    let mut buf = vec![0u8; 65536];
    loop {
        let n = local
            .read(&mut buf)
            .await
            .map_err(|e| format!("Local read failed: {}", e))?;
        if n == 0 {
            break;
        }
        remote
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("SFTP write failed: {}", e))?;
        copied += n as u64;

        if total_size > 0 {
            let progress = ((copied as f64 / total_size as f64) * 100.0) as u32;
            let _ = app.emit(
                &format!("sftp://progress/{}", host),
                serde_json::json!({
                    "type": "upload",
                    "path": remote_path,
                    "progress": progress,
                    "copied": copied,
                    "total": total_size,
                }),
            );
        }
    }

    let _ = app.emit(
        &format!("sftp://progress/{}", host),
        serde_json::json!({
            "type": "upload",
            "path": remote_path,
            "progress": 100,
            "done": true,
        }),
    );

    Ok(())
}

#[tauri::command]
pub async fn sftp_mkdir(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let mut conns = manager.connections.lock().await;
    let conn = conns
        .get_mut(&host)
        .ok_or_else(|| "Not connected".to_string())?;
    conn.sftp
        .create_dir(&path)
        .await
        .map_err(|e| format!("SFTP mkdir failed: {}", e))
}

#[tauri::command]
pub async fn sftp_rename(
    host: String,
    from: String,
    to: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let mut conns = manager.connections.lock().await;
    let conn = conns
        .get_mut(&host)
        .ok_or_else(|| "Not connected".to_string())?;
    conn.sftp
        .rename(&from, &to)
        .await
        .map_err(|e| format!("SFTP rename failed: {}", e))
}

#[tauri::command]
pub async fn sftp_delete(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let mut conns = manager.connections.lock().await;
    let conn = conns
        .get_mut(&host)
        .ok_or_else(|| "Not connected".to_string())?;
    conn.sftp
        .remove_file(&path)
        .await
        .map_err(|e| format!("SFTP delete failed: {}", e))
}

#[tauri::command]
pub async fn sftp_rmdir(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let mut conns = manager.connections.lock().await;
    let conn = conns
        .get_mut(&host)
        .ok_or_else(|| "Not connected".to_string())?;
    conn.sftp
        .remove_dir(&path)
        .await
        .map_err(|e| format!("SFTP rmdir failed: {}", e))
}

#[tauri::command]
pub async fn sftp_stat(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<SftpEntry, String> {
    let mut conns = manager.connections.lock().await;
    let conn = conns
        .get_mut(&host)
        .ok_or_else(|| "Not connected".to_string())?;
    let meta = conn
        .sftp
        .metadata(&path)
        .await
        .map_err(|e| format!("SFTP stat failed: {}", e))?;
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    Ok(SftpEntry {
        name,
        path,
        is_dir: meta.file_type().is_dir(),
        size: meta.len(),
        modified: meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())),
    })
}
