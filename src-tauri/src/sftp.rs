//! SFTP file transfer using russh + russh-sftp (pure-Rust SSH).
//! Replaces ssh2/libssh2 which doesn't support modern OpenSSH key exchange algorithms.
//!
//! Security: host keys are verified using trust-on-first-use (TOFU). The first
//! connection to a host stores its fingerprint; subsequent connections reject
//! the host if the fingerprint changes. Passphrase-protected keys are supported.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::sync::Mutex;

use russh::client;
use russh::client::AuthResult;
use russh::keys::*;
use russh::Disconnect;
use russh_sftp::{client::SftpSession, protocol::OpenFlags};
use tauri::{AppHandle, Emitter, State};

/// SSH client handler (required by russh, minimal implementation).
pub struct SshClient {
    known_hosts: Arc<Mutex<HashMap<String, String>>>,
    app_data_dir: Option<PathBuf>,
    host: String,
}

impl SshClient {
    async fn save_known_hosts(&self, hosts: &HashMap<String, String>) {
        if let Some(dir) = &self.app_data_dir {
            let path = dir.join("known_hosts.json");
            if let Ok(json) = serde_json::to_string_pretty(hosts) {
                let _ = tokio::fs::create_dir_all(dir).await;
                let _ = tokio::fs::write(&path, json).await;
            }
        }
    }
}

impl client::Handler for SshClient {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        let host = self.host.clone();
        let known_hosts = self.known_hosts.clone();
        let app_data_dir = self.app_data_dir.clone();
        let fingerprint = server_public_key
            .fingerprint(Default::default())
            .to_string();
        async move {
            let mut hosts = known_hosts.lock().await;
            if let Some(known) = hosts.get(&host) {
                return Ok(known == &fingerprint);
            }
            // First connect: store the fingerprint and persist it.
            hosts.insert(host.clone(), fingerprint);
            let client = SshClient {
                known_hosts: known_hosts.clone(),
                app_data_dir: app_data_dir.clone(),
                host: host.clone(),
            };
            client.save_known_hosts(&*hosts).await;
            Ok(true)
        }
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
    known_hosts: Arc<Mutex<HashMap<String, String>>>,
    transfer_cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    app_data_dir: Option<PathBuf>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            known_hosts: Arc::new(Mutex::new(HashMap::new())),
            transfer_cancellations: Arc::new(Mutex::new(HashMap::new())),
            app_data_dir: None,
        }
    }

    pub fn with_app_data_dir(app_data_dir: Option<PathBuf>) -> Self {
        let known_hosts = Self::load_known_hosts(&app_data_dir);
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            known_hosts: Arc::new(Mutex::new(known_hosts)),
            transfer_cancellations: Arc::new(Mutex::new(HashMap::new())),
            app_data_dir,
        }
    }

    fn load_known_hosts(app_data_dir: &Option<PathBuf>) -> HashMap<String, String> {
        if let Some(dir) = app_data_dir {
            let path = dir.join("known_hosts.json");
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&content) {
                    return map;
                }
            }
        }
        HashMap::new()
    }

    async fn save_known_hosts(&self) {
        if let Some(dir) = &self.app_data_dir {
            let path = dir.join("known_hosts.json");
            let hosts = self.known_hosts.lock().await;
            if let Ok(json) = serde_json::to_string_pretty(&*hosts) {
                let _ = tokio::fs::create_dir_all(dir).await;
                let _ = tokio::fs::write(&path, json).await;
            }
        }
    }

    /// Resolve SSH host via `ssh -G` and ~/.ssh/config.
    fn resolve_host(host: &str) -> (String, u16, String, Vec<String>) {
        let mut hostname: Option<String> = None;
        let mut port: Option<u16> = None;
        let mut user: Option<String> = None;
        let mut identity_files: Vec<String> = Vec::new();

        // Try ssh -G first
        if let Ok(out) = std::process::Command::new("ssh")
            .args(["-G", host])
            .output()
        {
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
                                        .or_insert((
                                            h.to_string(),
                                            22,
                                            user.clone().unwrap_or_default(),
                                        ));
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
                                            .or_insert((
                                                host.to_string(),
                                                port_num,
                                                user.clone().unwrap_or_default(),
                                            ));
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
        let user =
            user.unwrap_or_else(|| whoami::username().unwrap_or_else(|_| "root".to_string()));

        if identity_files.is_empty() {
            identity_files.push("~/.ssh/id_rsa".to_string());
            identity_files.push("~/.ssh/id_ed25519".to_string());
        }

        (hostname, port, user, identity_files)
    }

    /// Connect or return cached connection.
    pub async fn connect(&self, host: &str, passphrase: Option<String>) -> Result<(), String> {
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

        let client = SshClient {
            known_hosts: self.known_hosts.clone(),
            app_data_dir: self.app_data_dir.clone(),
            host: host.to_string(),
        };

        let mut session = client::connect(config, addr, client)
            .await
            .map_err(|e| format!("SSH connect failed: {}", e))?;

        // Try public key authentication first
        let mut authenticated = false;
        for key_path in identity_files {
            let expanded = shellexpand::tilde(&key_path).to_string();
            if std::path::Path::new(&expanded).exists() {
                let secret_key = load_secret_key(&expanded, passphrase.as_deref())
                    .map_err(|e| format!("Failed to load key {}: {}", expanded, e))?;
                let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(secret_key), None);
                match session
                    .authenticate_publickey(&username, key_with_hash)
                    .await
                {
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
            let _ = conn
                .session
                .disconnect(Disconnect::ByApplication, "Closed", "English")
                .await;
        }
    }

    /// Remove stored host key(s) for a host.
    pub async fn forget_host_keys(&self, host: &str) {
        {
            let mut hosts = self.known_hosts.lock().await;
            hosts.remove(host);
        }
        self.save_known_hosts().await;
    }

    /// A transfer id belongs to one queued transfer. Reusing it after a pause
    /// creates a fresh cancellation flag while retaining the staged partial
    /// file on disk or on the remote host.
    async fn begin_transfer(&self, id: &str) -> Arc<AtomicBool> {
        let cancelled = Arc::new(AtomicBool::new(false));
        self.transfer_cancellations
            .lock()
            .await
            .insert(id.to_string(), cancelled.clone());
        cancelled
    }

    async fn finish_transfer(&self, id: &str) {
        self.transfer_cancellations.lock().await.remove(id);
    }

    async fn cancel_transfer(&self, id: &str) -> bool {
        let transfers = self.transfer_cancellations.lock().await;
        let Some(cancelled) = transfers.get(id) else {
            return false;
        };
        cancelled.store(true, Ordering::Relaxed);
        true
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

fn remote_join(parent: &str, child: &str) -> String {
    if parent == "/" {
        format!("/{}", child)
    } else {
        format!("{}/{}", parent.trim_end_matches('/'), child)
    }
}

fn remote_basename(path: &str) -> Result<&str, String> {
    path.trim_end_matches('/')
        .rsplit('/')
        .find(|part| !part.is_empty())
        .ok_or_else(|| "The remote path has no file name".to_string())
}

async fn copy_remote_file(
    sftp: &mut SftpSession,
    from: &str,
    to: &str,
) -> Result<(), String> {
    let mut source = sftp
        .open(from)
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?;
    let mut destination = sftp
        .create(to)
        .await
        .map_err(|e| format!("SFTP create failed: {}", e))?;

    let mut buffer = vec![0u8; 65536];
    loop {
        let read = source
            .read(&mut buffer)
            .await
            .map_err(|e| format!("SFTP read failed: {}", e))?;
        if read == 0 {
            break;
        }
        destination
            .write_all(&buffer[..read])
            .await
            .map_err(|e| format!("SFTP write failed: {}", e))?;
    }
    Ok(())
}

async fn copy_remote_path(
    sftp: &mut SftpSession,
    from: &str,
    to: &str,
) -> Result<(), String> {
    if from == to {
        return Err("Choose a different destination to copy this item".to_string());
    }

    let source_meta = sftp
        .metadata(from)
        .await
        .map_err(|e| format!("SFTP stat failed: {}", e))?;

    if !source_meta.file_type().is_dir() {
        return copy_remote_file(sftp, from, to).await;
    }

    let source_root = from.trim_end_matches('/');
    if source_root.is_empty() || to.starts_with(&format!("{}/", source_root)) {
        return Err("A folder cannot be copied inside itself".to_string());
    }

    sftp.create_dir(to)
        .await
        .map_err(|e| format!("SFTP mkdir failed: {}", e))?;

    let mut pending = vec![(from.to_string(), to.to_string())];
    while let Some((source_dir, destination_dir)) = pending.pop() {
        let entries = sftp
            .read_dir(&source_dir)
            .await
            .map_err(|e| format!("SFTP readdir failed: {}", e))?;

        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let source_child = remote_join(&source_dir, &name);
            let destination_child = remote_join(&destination_dir, &name);
            if entry.metadata().file_type().is_dir() {
                sftp.create_dir(&destination_child)
                    .await
                    .map_err(|e| format!("SFTP mkdir failed: {}", e))?;
                pending.push((source_child, destination_child));
            } else {
                copy_remote_file(sftp, &source_child, &destination_child).await?;
            }
        }
    }
    Ok(())
}

async fn delete_remote_tree(sftp: &mut SftpSession, path: &str) -> Result<(), String> {
    let meta = sftp
        .metadata(path)
        .await
        .map_err(|e| format!("SFTP stat failed: {}", e))?;
    if !meta.file_type().is_dir() {
        return sftp
            .remove_file(path)
            .await
            .map_err(|e| format!("SFTP delete failed: {}", e));
    }

    /* Post-order traversal: files are removed as they are discovered; folders
       are only removed after every child has completed. */
    let mut pending = vec![(path.to_string(), false)];
    while let Some((directory, visited)) = pending.pop() {
        if visited {
            sftp.remove_dir(&directory)
                .await
                .map_err(|e| format!("SFTP rmdir failed: {}", e))?;
            continue;
        }

        pending.push((directory.clone(), true));
        let entries = sftp
            .read_dir(&directory)
            .await
            .map_err(|e| format!("SFTP readdir failed: {}", e))?;
        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child = remote_join(&directory, &name);
            if entry.metadata().file_type().is_dir() {
                pending.push((child, false));
            } else {
                sftp.remove_file(&child)
                    .await
                    .map_err(|e| format!("SFTP delete failed: {}", e))?;
            }
        }
    }
    Ok(())
}

fn local_staging_path(local_path: &Path, transfer_id: &str) -> Result<PathBuf, String> {
    let name = local_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "The local destination has no file name".to_string())?;
    Ok(local_path.with_file_name(format!(".{name}.husk-{transfer_id}.part")))
}

fn remote_staging_path(remote_path: &str, transfer_id: &str) -> String {
    format!("{remote_path}.husk-{transfer_id}.part")
}

fn ensure_not_cancelled(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::Relaxed) {
        Err("Transfer cancelled".to_string())
    } else {
        Ok(())
    }
}

fn emit_transfer_progress(
    app: &AppHandle,
    host: &str,
    transfer_id: &str,
    transfer_type: &str,
    path: &str,
    copied: u64,
    total: u64,
) {
    let progress = if total == 0 {
        0
    } else {
        ((copied as f64 / total as f64) * 100.0).round().min(100.0) as u32
    };
    let _ = app.emit(
        &format!("sftp://progress/{host}"),
        serde_json::json!({
            "id": transfer_id,
            "type": transfer_type,
            "path": path,
            "progress": progress,
            "copied": copied,
            "total": total,
        }),
    );
}

async fn download_remote_file(
    app: &AppHandle,
    host: &str,
    sftp: &mut SftpSession,
    remote_path: &str,
    local_path: &Path,
    transfer_id: &str,
    cancelled: &AtomicBool,
    resume: bool,
) -> Result<(), String> {
    ensure_not_cancelled(cancelled)?;
    let meta = sftp
        .metadata(remote_path)
        .await
        .map_err(|e| format!("SFTP stat failed: {}", e))?;
    let total_size = meta.len();
    let staging_path = local_staging_path(local_path, transfer_id)?;
    let staging_exists = tokio::fs::try_exists(&staging_path)
        .await
        .map_err(|e| format!("Local staging file check failed: {}", e))?;

    // A directory retry re-walks its contents. Files that completed before the
    // interruption have already been finalized, so do not download them again.
    if resume && !staging_exists {
        if let Ok(existing) = tokio::fs::metadata(local_path).await {
            if existing.len() == total_size {
                emit_transfer_progress(
                    app,
                    host,
                    transfer_id,
                    "download",
                    remote_path,
                    total_size,
                    total_size,
                );
                return Ok(());
            }
        }
    }

    let mut copied = if resume && staging_exists {
        tokio::fs::metadata(&staging_path)
            .await
            .map(|metadata| metadata.len())
            .unwrap_or(0)
    } else {
        0
    };
    if copied > total_size {
        copied = 0;
    }

    let mut remote = sftp
        .open(remote_path)
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?;
    if copied > 0 {
        remote
            .seek(SeekFrom::Start(copied))
            .await
            .map_err(|e| format!("SFTP seek failed: {}", e))?;
    }
    let mut local_options = tokio::fs::OpenOptions::new();
    local_options.create(true).write(true).read(true);
    if copied == 0 {
        local_options.truncate(true);
    }
    let mut local = local_options
        .open(&staging_path)
        .await
        .map_err(|e| format!("Local file create failed: {}", e))?;
    if copied > 0 {
        local
            .seek(SeekFrom::Start(copied))
            .await
            .map_err(|e| format!("Local seek failed: {}", e))?;
    }

    let mut buf = vec![0u8; 65536];
    loop {
        ensure_not_cancelled(cancelled)?;
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
        emit_transfer_progress(
            app,
            host,
            transfer_id,
            "download",
            remote_path,
            copied,
            total_size,
        );
    }
    ensure_not_cancelled(cancelled)?;
    local
        .sync_all()
        .await
        .map_err(|e| format!("Local file sync failed: {}", e))?;
    drop(local);
    if tokio::fs::try_exists(local_path)
        .await
        .map_err(|e| format!("Local file check failed: {}", e))?
    {
        tokio::fs::remove_file(local_path)
            .await
            .map_err(|e| format!("Local file replace failed: {}", e))?;
    }
    tokio::fs::rename(&staging_path, local_path)
        .await
        .map_err(|e| format!("Local file finalize failed: {}", e))?;
    Ok(())
}

async fn upload_local_file(
    app: &AppHandle,
    host: &str,
    sftp: &mut SftpSession,
    local_path: &Path,
    remote_path: &str,
    transfer_id: &str,
    cancelled: &AtomicBool,
    resume: bool,
) -> Result<(), String> {
    ensure_not_cancelled(cancelled)?;
    let total_size = tokio::fs::metadata(local_path)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let staging_path = remote_staging_path(remote_path, transfer_id);
    let staging_size = sftp.metadata(&staging_path).await.ok().map(|metadata| metadata.len());

    // As with downloads, a resumed directory walk skips children that had
    // already been atomically finalized before the interruption.
    if resume && staging_size.is_none() {
        if let Ok(existing) = sftp.metadata(remote_path).await {
            if existing.len() == total_size {
                emit_transfer_progress(
                    app,
                    host,
                    transfer_id,
                    "upload",
                    remote_path,
                    total_size,
                    total_size,
                );
                return Ok(());
            }
        }
    }

    let mut copied = if resume { staging_size.unwrap_or(0) } else { 0 };
    if copied > total_size {
        copied = 0;
    }
    let mut local = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| format!("Local file open failed: {}", e))?;
    if copied > 0 {
        local
            .seek(SeekFrom::Start(copied))
            .await
            .map_err(|e| format!("Local seek failed: {}", e))?;
    }
    let mut remote = if copied > 0 {
        sftp.open_with_flags(
            &staging_path,
            OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::READ,
        )
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?
    } else {
        sftp.create(&staging_path)
            .await
            .map_err(|e| format!("SFTP create failed: {}", e))?
    };
    if copied > 0 {
        remote
            .seek(SeekFrom::Start(copied))
            .await
            .map_err(|e| format!("SFTP seek failed: {}", e))?;
    }

    let mut buf = vec![0u8; 65536];
    loop {
        ensure_not_cancelled(cancelled)?;
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
        emit_transfer_progress(
            app,
            host,
            transfer_id,
            "upload",
            remote_path,
            copied,
            total_size,
        );
    }
    ensure_not_cancelled(cancelled)?;
    remote
        .sync_all()
        .await
        .map_err(|e| format!("SFTP sync failed: {}", e))?;
    drop(remote);
    if let Ok(existing) = sftp.metadata(remote_path).await {
        if existing.file_type().is_dir() {
            delete_remote_tree(sftp, remote_path).await?;
        } else {
            sftp.remove_file(remote_path)
                .await
                .map_err(|e| format!("SFTP replace failed: {}", e))?;
        }
    }
    sftp.rename(&staging_path, remote_path)
        .await
        .map_err(|e| format!("SFTP finalize failed: {}", e))?;
    Ok(())
}

/// Make `path` a directory. A local upload is the authority for its own path,
/// so a remote file at that path is replaced. Existing remote directories are
/// deliberately preserved for a merge upload.
async fn ensure_remote_directory(sftp: &mut SftpSession, path: &str) -> Result<(), String> {
    match sftp.metadata(path).await {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
        Ok(_) => {
            sftp.remove_file(path)
                .await
                .map_err(|e| format!("SFTP replace file with folder failed: {}", e))?;
            sftp.create_dir(path)
                .await
                .map_err(|e| format!("SFTP mkdir failed: {}", e))
        }
        Err(_) => sftp
            .create_dir(path)
            .await
            .map_err(|e| format!("SFTP mkdir failed: {}", e)),
    }
}

#[tauri::command]
pub async fn sftp_connect(
    host: String,
    passphrase: Option<String>,
    manager: State<'_, SftpManager>,
) -> Result<bool, String> {
    manager.connect(&host, passphrase).await.map(|_| true)
}

#[tauri::command]
pub async fn sftp_disconnect(host: String, manager: State<'_, SftpManager>) -> Result<(), String> {
    manager.disconnect(&host).await;
    Ok(())
}

#[tauri::command]
pub async fn sftp_transfer_cancel(
    transfer_id: String,
    manager: State<'_, SftpManager>,
) -> Result<bool, String> {
    Ok(manager.cancel_transfer(&transfer_id).await)
}

#[tauri::command]
pub async fn sftp_forget_host_keys(
    host: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    manager.forget_host_keys(&host).await;
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
            modified: meta.modified().ok().and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|d| d.as_secs())
            }),
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
    transfer_id: String,
    resume: bool,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let cancelled = manager.begin_transfer(&transfer_id).await;
    let result = {
        let mut conns = manager.connections.lock().await;
        let conn = conns
            .get_mut(&host)
            .ok_or_else(|| "Not connected".to_string())?;
        download_remote_file(
            &app,
            &host,
            &mut conn.sftp,
            &remote_path,
            Path::new(&local_path),
            &transfer_id,
            &cancelled,
            resume,
        )
        .await
    };
    manager.finish_transfer(&transfer_id).await;
    result
}

#[tauri::command]
pub async fn sftp_download_dir(
    app: AppHandle,
    host: String,
    remote_path: String,
    local_parent: String,
    transfer_id: String,
    resume: bool,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let destination = PathBuf::from(local_parent).join(remote_basename(&remote_path)?);
    let cancelled = manager.begin_transfer(&transfer_id).await;
    let result = async {
        let mut conns = manager.connections.lock().await;
        let conn = conns
            .get_mut(&host)
            .ok_or_else(|| "Not connected".to_string())?;
        if resume {
            tokio::fs::create_dir_all(&destination)
                .await
                .map_err(|e| format!("Local folder create failed: {}", e))?;
        } else {
            tokio::fs::create_dir(&destination)
                .await
                .map_err(|e| format!("Local folder create failed: {}", e))?;
        }

        let mut pending = vec![(remote_path, destination)];
        while let Some((remote_dir, local_dir)) = pending.pop() {
            ensure_not_cancelled(&cancelled)?;
            let entries = conn
                .sftp
                .read_dir(&remote_dir)
                .await
                .map_err(|e| format!("SFTP readdir failed: {}", e))?;
            for entry in entries {
                ensure_not_cancelled(&cancelled)?;
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let remote_child = remote_join(&remote_dir, &name);
                let local_child = local_dir.join(&name);
                if entry.metadata().file_type().is_dir() {
                    tokio::fs::create_dir_all(&local_child)
                        .await
                        .map_err(|e| format!("Local folder create failed: {}", e))?;
                    pending.push((remote_child, local_child));
                } else {
                    download_remote_file(
                        &app,
                        &host,
                        &mut conn.sftp,
                        &remote_child,
                        &local_child,
                        &transfer_id,
                        &cancelled,
                        resume,
                    )
                    .await?;
                }
            }
        }
        Ok(())
    }
    .await;
    manager.finish_transfer(&transfer_id).await;
    result
}

#[tauri::command]
pub async fn sftp_upload(
    app: AppHandle,
    host: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
    resume: bool,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let cancelled = manager.begin_transfer(&transfer_id).await;
    let result = {
        let mut conns = manager.connections.lock().await;
        let conn = conns
            .get_mut(&host)
            .ok_or_else(|| "Not connected".to_string())?;
        upload_local_file(
            &app,
            &host,
            &mut conn.sftp,
            Path::new(&local_path),
            &remote_path,
            &transfer_id,
            &cancelled,
            resume,
        )
        .await
    };
    manager.finish_transfer(&transfer_id).await;
    result
}

#[tauri::command]
pub async fn sftp_upload_dir(
    app: AppHandle,
    host: String,
    local_path: String,
    remote_parent: String,
    transfer_id: String,
    resume: bool,
    conflict_mode: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    if conflict_mode != "merge" && conflict_mode != "replace" {
        return Err("Unsupported folder conflict mode".to_string());
    }
    let local_root = PathBuf::from(&local_path);
    let name = local_root
        .file_name()
        .and_then(|part| part.to_str())
        .filter(|part| !part.is_empty())
        .ok_or_else(|| "The local folder has no name".to_string())?;
    let remote_root = remote_join(&remote_parent, name);
    let cancelled = manager.begin_transfer(&transfer_id).await;
    let result = async {
        let mut conns = manager.connections.lock().await;
        let conn = conns
            .get_mut(&host)
            .ok_or_else(|| "Not connected".to_string())?;
        // A replacement applies only to the initial attempt. Retrying or
        // resuming must retain staged partial data, so it merges the remaining
        // local tree into whatever the first attempt already created.
        if !resume && conflict_mode == "replace" && conn.sftp.metadata(&remote_root).await.is_ok() {
            delete_remote_tree(&mut conn.sftp, &remote_root).await?;
        }
        ensure_remote_directory(&mut conn.sftp, &remote_root).await?;

        let mut pending = vec![(local_root, remote_root)];
        while let Some((local_dir, remote_dir)) = pending.pop() {
            ensure_not_cancelled(&cancelled)?;
            let mut entries = tokio::fs::read_dir(&local_dir)
                .await
                .map_err(|e| format!("Local folder read failed: {}", e))?;
            while let Some(entry) = entries
                .next_entry()
                .await
                .map_err(|e| format!("Local folder read failed: {}", e))?
            {
                ensure_not_cancelled(&cancelled)?;
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                let remote_child = remote_join(&remote_dir, &name);
                let file_type = entry
                    .file_type()
                    .await
                    .map_err(|e| format!("Local file type failed: {}", e))?;
                if file_type.is_dir() {
                    ensure_remote_directory(&mut conn.sftp, &remote_child).await?;
                    pending.push((path, remote_child));
                } else if file_type.is_file() {
                    upload_local_file(
                        &app,
                        &host,
                        &mut conn.sftp,
                        &path,
                        &remote_child,
                        &transfer_id,
                        &cancelled,
                        resume,
                    )
                    .await?;
                }
            }
        }
        Ok(())
    }
    .await;
    manager.finish_transfer(&transfer_id).await;
    result
}

#[tauri::command]
pub async fn sftp_copy(
    host: String,
    from: String,
    to: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let mut conns = manager.connections.lock().await;
    let conn = conns
        .get_mut(&host)
        .ok_or_else(|| "Not connected".to_string())?;
    copy_remote_path(&mut conn.sftp, &from, &to).await
}

#[tauri::command]
pub async fn sftp_delete_recursive(
    host: String,
    path: String,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let mut conns = manager.connections.lock().await;
    let conn = conns
        .get_mut(&host)
        .ok_or_else(|| "Not connected".to_string())?;
    delete_remote_tree(&mut conn.sftp, &path).await
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
        modified: meta.modified().ok().and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_secs())
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::{ensure_not_cancelled, local_staging_path, remote_staging_path};
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn transfer_staging_paths_stay_next_to_their_final_targets() {
        let local = local_staging_path(Path::new("/tmp/archive.zip"), "sftp-abc").unwrap();
        assert_eq!(local, Path::new("/tmp/.archive.zip.husk-sftp-abc.part"));
        assert_eq!(
            remote_staging_path("/srv/archive.zip", "sftp-abc"),
            "/srv/archive.zip.husk-sftp-abc.part"
        );
    }

    #[test]
    fn cancellation_is_detected_before_another_transfer_chunk() {
        let cancelled = AtomicBool::new(false);
        assert!(ensure_not_cancelled(&cancelled).is_ok());
        cancelled.store(true, Ordering::Relaxed);
        assert_eq!(ensure_not_cancelled(&cancelled), Err("Transfer cancelled".to_string()));
    }
}
