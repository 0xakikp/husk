//! SFTP file transfer using ssh2 crate.
//! Persistent SSH connections with SFTP subsystem for fast upload/download.

use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::Mutex;

use ssh2::Session;
use tauri::State;

/// Resolved SSH config: (HostName, Port).
fn resolve_ssh_host(host: &str) -> (String, u16) {
    // Try ssh -G first (most reliable)
    let output = std::process::Command::new("ssh")
        .args(["-G", host])
        .output();

    let mut hostname: Option<String> = None;
    let mut port: Option<u16> = None;

    if let Ok(out) = output {
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
                }
            }
        }
    }

    if hostname.is_some() && port.is_some() {
        return (hostname.unwrap(), port.unwrap());
    }

    // Fallback: parse ~/.ssh/config manually
    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let config_path = format!("{}/.ssh/config", home);
    let content = std::fs::read_to_string(&config_path).unwrap_or_default();

    let mut current_hosts: Vec<String> = Vec::new();
    let mut host_map: HashMap<String, (String, u16)> = HashMap::new();

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
                                .or_insert((h.to_string(), 22));
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
                                    .or_insert((host.to_string(), port_num));
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some((h, p)) = host_map.get(host) {
        return (h.clone(), *p);
    }

    (host.to_string(), port.unwrap_or(22))
}

fn get_ssh_identity_files(host: &str) -> Vec<String> {
    let output = std::process::Command::new("ssh")
        .args(["-G", host])
        .output();

    let mut files = Vec::new();
    if let Ok(out) = output {
        if out.status.success() {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                if line.to_lowercase().starts_with("identityfile ") {
                    if let Some(f) = line.split_whitespace().nth(1) {
                        files.push(f.to_string());
                    }
                }
            }
        }
    }
    if files.is_empty() {
        files.push("~/.ssh/id_rsa".to_string());
        files.push("~/.ssh/id_ed25519".to_string());
    }
    files
}

fn get_ssh_user(host: &str) -> String {
    let output = std::process::Command::new("ssh")
        .args(["-G", host])
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                if line.to_lowercase().starts_with("user ") {
                    if let Some(u) = line.split_whitespace().nth(1) {
                        return u.to_string();
                    }
                }
            }
        }
    }
    // Fallback: current user
    whoami::username().unwrap_or_else(|_| "root".to_string())
}

/// Shared SFTP session manager.
#[derive(Clone)]
pub struct SftpManager {
    sessions: std::sync::Arc<Mutex<HashMap<String, Session>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            sessions: std::sync::Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn connect(&self, host: &str) -> Result<Session, String> {
        let (actual_host, port) = resolve_ssh_host(host);

        // Check cache first
        {
            let mut map = self.sessions.lock().unwrap();
            if let Some(sess) = map.get(host) {
                if !sess.authenticated() {
                    map.remove(host);
                } else {
                    return Ok(sess.clone());
                }
            }
        }

        // Blocking SSH connect
        let tcp = TcpStream::connect(format!("{}:{}", actual_host, port))
            .map_err(|e| format!("TCP connect failed: {}", e))?;
        tcp.set_read_timeout(Some(std::time::Duration::from_secs(30)))
            .ok();
        tcp.set_write_timeout(Some(std::time::Duration::from_secs(30)))
            .ok();

        let mut sess =
            Session::new().map_err(|e| format!("Session creation failed: {}", e))?;
        sess.set_tcp_stream(tcp);
        sess.handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Try SSH agent first
        let username = get_ssh_user(host);
        if sess.userauth_agent(&username).is_ok() && sess.authenticated() {
            let mut map = self.sessions.lock().unwrap();
            map.insert(host.to_string(), sess.clone());
            return Ok(sess);
        }

        // Try all identity files from ssh -G output
        let identity_files = get_ssh_identity_files(host);
        for key_path in identity_files {
            let expanded = shellexpand::tilde(&key_path).to_string();
            if std::path::Path::new(&expanded).exists() {
                if sess
                    .userauth_pubkey_file(&username, None, std::path::Path::new(&expanded), None)
                    .is_ok()
                    && sess.authenticated()
                {
                    return Ok(sess);
                }
            }
        }

        Err(
            "SSH authentication failed. Ensure your key is in ssh-agent, or add IdentityFile to ~/.ssh/config"
                .to_string(),
        )
    }
}

impl Default for SftpManager {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(serde::Serialize)]
pub struct SftpEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: Option<u64>,
}

#[tauri::command]
pub async fn sftp_connect(
    host: String,
    manager: State<'_, SftpManager>,
) -> Result<bool, String> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || manager.connect(&host))
        .await
        .map_err(|e| format!("SFTP task failed: {}", e))?
        .map(|_| true)
}

#[tauri::command]
pub async fn sftp_disconnect(
    host: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let mut map = manager.sessions.lock().unwrap();
    map.remove(&host);
    Ok(())
}

#[tauri::command]
pub async fn sftp_list_dir(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<Vec<SftpEntry>, String> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        let sess = manager.connect(&host)?;
        let sftp = sess
            .sftp()
            .map_err(|e| format!("SFTP init failed: {}", e))?;

        let mut entries = Vec::new();
        // Normalize path: resolve . and .. to absolute paths
        let normalized = if path == "." {
            ".".to_string()
        } else if path == ".." {
            "..".to_string()
        } else {
            path.trim_end_matches('/').to_string()
        };
        let dir = sftp
            .readdir(std::path::Path::new(&normalized))
            .map_err(|e| format!("SFTP readdir failed: {}", e))?;

        for (name, stat) in dir {
            let name = name.to_string_lossy().to_string();
            if name == "." || name == ".." {
                continue;
            }
            // Build absolute path: if parent is "/", don't add extra slash
            let entry_path = if normalized == "/" {
                format!("/{}", name)
            } else {
                format!("{}/{}", normalized, name)
            };
            let is_dir = stat.is_dir();
            let size = stat.size.unwrap_or(0);
            let modified = stat.mtime.map(|t| t as u64);

            entries.push(SftpEntry {
                name,
                path: entry_path,
                is_dir,
                size,
                modified,
            });
        }

        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(entries)
    })
    .await
    .map_err(|e| format!("SFTP task failed: {}", e))?
}

#[tauri::command]
pub async fn sftp_download(
    host: String,
    remote_path: String,
    local_path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        let sess = manager.connect(&host)?;
        let sftp = sess
            .sftp()
            .map_err(|e| format!("SFTP init failed: {}", e))?;

        let mut remote = sftp
            .open(std::path::Path::new(&remote_path))
            .map_err(|e| format!("SFTP open failed: {}", e))?;
        let mut local = std::fs::File::create(&local_path)
            .map_err(|e| format!("Local file create failed: {}", e))?;

        std::io::copy(&mut remote, &mut local)
            .map_err(|e| format!("SFTP download failed: {}", e))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("SFTP task failed: {}", e))?
}

#[tauri::command]
pub async fn sftp_upload(
    host: String,
    local_path: String,
    remote_path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        let sess = manager.connect(&host)?;
        let sftp = sess
            .sftp()
            .map_err(|e| format!("SFTP init failed: {}", e))?;

        let mut local =
            std::fs::File::open(&local_path).map_err(|e| format!("Local file open failed: {}", e))?;
        let mut remote = sftp
            .create(std::path::Path::new(&remote_path))
            .map_err(|e| format!("SFTP create failed: {}", e))?;

        std::io::copy(&mut local, &mut remote)
            .map_err(|e| format!("SFTP upload failed: {}", e))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("SFTP task failed: {}", e))?
}

#[tauri::command]
pub async fn sftp_mkdir(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        let sess = manager.connect(&host)?;
        let sftp = sess
            .sftp()
            .map_err(|e| format!("SFTP init failed: {}", e))?;
        sftp.mkdir(std::path::Path::new(&path), 0o755)
            .map_err(|e| format!("SFTP mkdir failed: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("SFTP task failed: {}", e))?
}

#[tauri::command]
pub async fn sftp_rename(
    host: String,
    from: String,
    to: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        let sess = manager.connect(&host)?;
        let sftp = sess
            .sftp()
            .map_err(|e| format!("SFTP init failed: {}", e))?;
        sftp.rename(std::path::Path::new(&from), std::path::Path::new(&to), None)
            .map_err(|e| format!("SFTP rename failed: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("SFTP task failed: {}", e))?
}

#[tauri::command]
pub async fn sftp_delete(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        let sess = manager.connect(&host)?;
        let sftp = sess
            .sftp()
            .map_err(|e| format!("SFTP init failed: {}", e))?;
        sftp.unlink(std::path::Path::new(&path))
            .map_err(|e| format!("SFTP delete failed: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("SFTP task failed: {}", e))?
}

#[tauri::command]
pub async fn sftp_rmdir(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        let sess = manager.connect(&host)?;
        let sftp = sess
            .sftp()
            .map_err(|e| format!("SFTP init failed: {}", e))?;
        sftp.rmdir(std::path::Path::new(&path))
            .map_err(|e| format!("SFTP rmdir failed: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("SFTP task failed: {}", e))?
}

#[tauri::command]
pub async fn sftp_stat(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<SftpEntry, String> {
    let manager = manager.inner().clone();
    tokio::task::spawn_blocking(move || {
        let sess = manager.connect(&host)?;
        let sftp = sess
            .sftp()
            .map_err(|e| format!("SFTP init failed: {}", e))?;
        let stat = sftp
            .stat(std::path::Path::new(&path))
            .map_err(|e| format!("SFTP stat failed: {}", e))?;

        let name = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());

        Ok(SftpEntry {
            name,
            path,
            is_dir: stat.is_dir(),
            size: stat.size.unwrap_or(0),
            modified: stat.mtime.map(|t| t as u64),
        })
    })
    .await
    .map_err(|e| format!("SFTP task failed: {}", e))?
}
