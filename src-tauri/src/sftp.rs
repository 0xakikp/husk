//! SFTP file transfer using ssh2 crate.
//! Persistent SSH connections with SFTP subsystem for fast upload/download.

use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::Mutex;

use ssh2::Session;
use tauri::State;

/// Shared SFTP session manager.
pub struct SftpManager {
    sessions: Mutex<HashMap<String, Session>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn connect(&self, host: &str) -> Result<Session, String> {
        let mut map = self.sessions.lock().unwrap();
        if let Some(sess) = map.get(host) {
            if !sess.authenticated() {
                map.remove(host);
            } else {
                return Ok(sess.clone());
            }
        }

        let tcp = TcpStream::connect(format!("{}:22", host))
            .map_err(|e| format!("TCP connect failed: {}", e))?;
        tcp.set_read_timeout(Some(std::time::Duration::from_secs(30)))
            .ok();
        tcp.set_write_timeout(Some(std::time::Duration::from_secs(30)))
            .ok();

        let mut sess = Session::new().map_err(|e| format!("Session creation failed: {}", e))?;
        sess.set_tcp_stream(tcp);
        sess.handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Try SSH agent first
        if sess.userauth_agent("").is_ok() && sess.authenticated() {
            map.insert(host.to_string(), sess.clone());
            return Ok(sess);
        }

        // Try default key locations
        let home = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        for key_path in ["id_rsa", "id_ed25519"] {
            let expanded = format!("{}/.ssh/{}", home, key_path);
            if std::path::Path::new(&expanded).exists() {
                if sess
                    .userauth_pubkey_file("", None, std::path::Path::new(&expanded), None)
                    .is_ok()
                    && sess.authenticated()
                {
                    map.insert(host.to_string(), sess.clone());
                    return Ok(sess);
                }
            }
        }

        Err("SSH authentication failed. Ensure your key is in ssh-agent or ~/.ssh/".to_string())
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
pub fn sftp_connect(host: String, manager: State<'_, SftpManager>) -> Result<bool, String> {
    manager.connect(&host)?;
    Ok(true)
}

#[tauri::command]
pub fn sftp_disconnect(host: String, manager: State<'_, SftpManager>) -> Result<(), String> {
    let mut map = manager.sessions.lock().unwrap();
    map.remove(&host);
    Ok(())
}

#[tauri::command]
pub fn sftp_list_dir(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<Vec<SftpEntry>, String> {
    let sess = manager.connect(&host)?;
    let sftp = sess
        .sftp()
        .map_err(|e| format!("SFTP init failed: {}", e))?;

    let mut entries = Vec::new();
    let dir = sftp
        .readdir(std::path::Path::new(&path))
        .map_err(|e| format!("SFTP readdir failed: {}", e))?;

    for (name, stat) in dir {
        let name = name.to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }
        let entry_path = format!("{}/{}", path.trim_end_matches('/'), name);
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
}

#[tauri::command]
pub fn sftp_download(
    host: String,
    remote_path: String,
    local_path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let sess = manager.connect(&host)?;
    let sftp = sess
        .sftp()
        .map_err(|e| format!("SFTP init failed: {}", e))?;

    let mut remote = sftp
        .open(std::path::Path::new(&remote_path))
        .map_err(|e| format!("SFTP open failed: {}", e))?;
    let mut local = std::fs::File::create(&local_path)
        .map_err(|e| format!("Local file create failed: {}", e))?;

    std::io::copy(&mut remote, &mut local).map_err(|e| format!("SFTP download failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn sftp_upload(
    host: String,
    local_path: String,
    remote_path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let sess = manager.connect(&host)?;
    let sftp = sess
        .sftp()
        .map_err(|e| format!("SFTP init failed: {}", e))?;

    let mut local =
        std::fs::File::open(&local_path).map_err(|e| format!("Local file open failed: {}", e))?;
    let mut remote = sftp
        .create(std::path::Path::new(&remote_path))
        .map_err(|e| format!("SFTP create failed: {}", e))?;

    std::io::copy(&mut local, &mut remote).map_err(|e| format!("SFTP upload failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn sftp_mkdir(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let sess = manager.connect(&host)?;
    let sftp = sess
        .sftp()
        .map_err(|e| format!("SFTP init failed: {}", e))?;
    sftp.mkdir(std::path::Path::new(&path), 0o755)
        .map_err(|e| format!("SFTP mkdir failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn sftp_rename(
    host: String,
    from: String,
    to: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let sess = manager.connect(&host)?;
    let sftp = sess
        .sftp()
        .map_err(|e| format!("SFTP init failed: {}", e))?;
    sftp.rename(std::path::Path::new(&from), std::path::Path::new(&to), None)
        .map_err(|e| format!("SFTP rename failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn sftp_delete(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let sess = manager.connect(&host)?;
    let sftp = sess
        .sftp()
        .map_err(|e| format!("SFTP init failed: {}", e))?;
    sftp.unlink(std::path::Path::new(&path))
        .map_err(|e| format!("SFTP delete failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn sftp_rmdir(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let sess = manager.connect(&host)?;
    let sftp = sess
        .sftp()
        .map_err(|e| format!("SFTP init failed: {}", e))?;
    sftp.rmdir(std::path::Path::new(&path))
        .map_err(|e| format!("SFTP rmdir failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn sftp_stat(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<SftpEntry, String> {
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
}
