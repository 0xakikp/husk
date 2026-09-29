//! SFTP file transfer using russh + russh-sftp.
//! Connections and host verification are independent from terminal SSH sessions.
//! Unknown server keys require explicit confirmation before any authentication.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

use russh::client;
use russh::client::AuthResult;
use russh::keys::*;
use russh::Disconnect;
use russh_sftp::{client::SftpSession, protocol::OpenFlags};
use tauri::{AppHandle, Emitter, State};

#[path = "sftp_connection.rs"]
mod connection_config;
pub use connection_config::{SftpConnectResult, SftpCredentials, SftpTarget};
use connection_config::{AuthType, ResolvedTarget, VerifiedHosts, parse_verified_hosts, resolve_target, validate_session_key, verified_key};

/// The callback never trusts an unknown key. It records evidence for the UI and
/// rejects the first handshake before a username, password, or key is offered.
pub struct SshClient {
    stored: Option<String>,
    confirmation: Option<String>,
    observed: Arc<Mutex<Option<String>>>,
}

impl client::Handler for SshClient {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> impl std::future::Future<Output = Result<bool, Self::Error>> + Send {
        let observed = self.observed.clone();
        let stored = self.stored.clone();
        let confirmation = self.confirmation.clone();
        let fingerprint = server_public_key.fingerprint(Default::default()).to_string();
        async move {
            *observed.lock().await = Some(fingerprint.clone());
            Ok(verified_key(stored.as_deref(), confirmation.as_deref(), &fingerprint).unwrap_or(false))
        }
    }
}

struct Connection {
    session: client::Handle<SshClient>,
    sftp: SftpSession,
    target: ResolvedTarget,
    result: SftpConnectResult,
}

struct PendingHostVerification {
    target: ResolvedTarget,
    fingerprint: String,
}

/// Verified fingerprints use a new versioned store. Legacy automatic-TOFU
/// records are deliberately not read as proof that a human verified the host.
#[derive(Clone)]
pub struct SftpManager {
    connections: Arc<Mutex<HashMap<String, Connection>>>,
    known_hosts: Arc<Mutex<HashMap<String, String>>>,
    trust_error: Option<String>,
    pending_connections: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pending_verifications: Arc<Mutex<HashMap<String, PendingHostVerification>>>,
    transfer_cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    app_data_dir: Option<PathBuf>,
}

impl SftpManager {
    pub fn new() -> Self { Self::with_app_data_dir(None) }

    pub fn with_app_data_dir(app_data_dir: Option<PathBuf>) -> Self {
        let loaded = Self::load_known_hosts(&app_data_dir);
        let trust_error = loaded.as_ref().err().cloned();
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            known_hosts: Arc::new(Mutex::new(loaded.unwrap_or_default())),
            trust_error,
            pending_connections: Arc::new(Mutex::new(HashMap::new())),
            pending_verifications: Arc::new(Mutex::new(HashMap::new())),
            transfer_cancellations: Arc::new(Mutex::new(HashMap::new())),
            app_data_dir,
        }
    }

    fn load_known_hosts(app_data_dir: &Option<PathBuf>) -> Result<HashMap<String, String>, String> {
        let Some(dir) = app_data_dir else { return Ok(HashMap::new()); };
        let path = dir.join("sftp_verified_hosts.json");
        match std::fs::read_to_string(path) {
            Ok(content) if content.len() <= 1024 * 1024 => parse_verified_hosts(&content),
            Ok(_) => Err("The verified SFTP host-key store is too large; repair it before connecting".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(_) => Err("Could not read the verified SFTP host-key store; no new keys will be trusted".into()),
        }
    }

    async fn save_known_hosts(&self, hosts: &HashMap<String, String>) -> Result<(), String> {
        let Some(dir) = &self.app_data_dir else { return Ok(()); };
        tokio::fs::create_dir_all(dir).await.map_err(|_| "Could not create the SFTP trust directory")?;
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let nonce = SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let temp = dir.join(format!(".sftp-verified-{}-{timestamp}-{nonce}.tmp", std::process::id()));
        let path = dir.join("sftp_verified_hosts.json");
        let json = serde_json::to_vec(&VerifiedHosts { version: 1, hosts: hosts.clone() })
            .map_err(|_| "Could not encode verified SFTP host keys")?;
        let result = async {
            let mut options = tokio::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options.open(&temp).await.map_err(|_| "Could not write verified SFTP host keys")?;
            file.write_all(&json).await.map_err(|_| "Could not write verified SFTP host keys")?;
            file.sync_all().await.map_err(|_| "Could not save verified SFTP host keys")?;
            drop(file);
            tokio::fs::rename(&temp, path).await.map_err(|_| "Could not replace verified SFTP host keys")
        }.await;
        if result.is_err() { let _ = tokio::fs::remove_file(temp).await; }
        result.map_err(str::to_string)
    }

    async fn begin_connection(&self, host: &str, confirming: bool) -> (Arc<AtomicBool>, Option<PendingHostVerification>) {
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut pending = self.pending_connections.lock().await;
        if let Some(previous) = pending.insert(host.to_string(), cancelled.clone()) {
            previous.store(true, Ordering::SeqCst);
        }
        // Both a fresh attempt and a confirmation consume any old challenge.
        // Keep the generation lock until consumption so another attempt cannot
        // borrow a verification recorded for an intervening connection.
        let verification = self.pending_verifications.lock().await.remove(host);
        (cancelled, if confirming { verification } else { None })
    }

    fn ensure_current(cancelled: &AtomicBool) -> Result<(), String> {
        if cancelled.load(Ordering::SeqCst) { Err("SFTP connection was cancelled".into()) } else { Ok(()) }
    }

    fn check_confirmation(
        target: &ResolvedTarget, confirmation: Option<&str>, verification: Option<&PendingHostVerification>,
    ) -> Result<(), String> {
        let Some(confirmation) = confirmation else { return Ok(()); };
        let verification = verification.ok_or("No pending SFTP host verification. Connect again to review this server's identity")?;
        if &verification.target != target || verification.fingerprint != confirmation {
            return Err("The SFTP target or fingerprint changed while awaiting verification. Connect again and verify the new target before authenticating".into());
        }
        Ok(())
    }

    async fn record_verification(
        &self, host: &str, target: ResolvedTarget, fingerprint: String, cancelled: &Arc<AtomicBool>,
    ) -> Result<(), String> {
        let pending = self.pending_connections.lock().await;
        Self::ensure_current(cancelled)?;
        if !pending.get(host).is_some_and(|current| Arc::ptr_eq(current, cancelled)) {
            return Err("SFTP connection was cancelled".into());
        }
        self.pending_verifications.lock().await.insert(host.to_string(), PendingHostVerification { target, fingerprint });
        Ok(())
    }

    async fn finish_connection(&self, host: &str, cancelled: &Arc<AtomicBool>, keep_verification: bool) {
        let mut pending = self.pending_connections.lock().await;
        if pending.get(host).is_some_and(|current| Arc::ptr_eq(current, cancelled)) {
            pending.remove(host);
            if !keep_verification { self.pending_verifications.lock().await.remove(host); }
        }
    }

    pub async fn connect(
        &self, host: &str, target: Option<SftpTarget>, credentials: Option<SftpCredentials>,
        expected_fingerprint: Option<String>,
    ) -> Result<SftpConnectResult, String> {
        validate_session_key(host)?;
        if let Some(error) = &self.trust_error { return Err(error.clone()); }
        if expected_fingerprint.as_ref().is_some_and(|value| value.len() > 200 || !value.starts_with("SHA256:") || value.chars().any(char::is_control)) {
            return Err("Invalid server fingerprint confirmation".into());
        }
        // Reserve the cancellation generation before local config resolution.
        let (cancelled, verification) = self.begin_connection(host, expected_fingerprint.is_some()).await;
        let explicit = target.unwrap_or_else(|| SftpTarget {
            host: host.to_string(), user: None, port: None, identity_file: None, auth_type: None, jump_host: None,
        });
        let result = async {
            let target = tokio::task::spawn_blocking(move || resolve_target(explicit)).await
                .map_err(|_| "Could not resolve the SFTP target")??;
            Self::ensure_current(&cancelled)?;
            Self::check_confirmation(&target, expected_fingerprint.as_deref(), verification.as_ref())?;
            {
                let mut connections = self.connections.lock().await;
                if let Some(existing) = connections.get(host) {
                    if existing.target != target { return Err("This SFTP session belongs to a different target. Disconnect before changing the target".into()); }
                    if !existing.session.is_closed() {
                        if expected_fingerprint.as_ref().is_some_and(|value| value != &existing.result.fingerprint) {
                            return Err("The confirmed fingerprint does not match the connected server".into());
                        }
                        return Ok(existing.result.clone());
                    }
                }
                connections.remove(host);
            }
            self.connect_resolved(host, target, credentials.unwrap_or_default(), expected_fingerprint, &cancelled).await
        }.await;
        self.finish_connection(host, &cancelled, result.as_ref().is_ok_and(|result| result.status == "verify-host")).await;
        result
    }

    async fn connect_resolved(
        &self, host: &str, target: ResolvedTarget, credentials: SftpCredentials,
        confirmation: Option<String>, cancelled: &Arc<AtomicBool>,
    ) -> Result<SftpConnectResult, String> {
        let endpoint = target.endpoint();
        let stored = self.known_hosts.lock().await.get(&endpoint).cloned();
        let observed = Arc::new(Mutex::new(None));
        let handler = SshClient { stored: stored.clone(), confirmation: confirmation.clone(), observed: observed.clone() };
        let config = Arc::new(client::Config {
            keepalive_interval: Some(Duration::from_secs(30)), keepalive_max: 3,
            ..Default::default()
        });
        Self::ensure_current(cancelled)?;
        // Passing (hostname, port), rather than SocketAddr::parse, supports DNS
        // and IPv6 without treating an SSH alias as an address or shell command.
        let connected = tokio::time::timeout(Duration::from_secs(15),
            client::connect(config, (target.hostname.as_str(), target.port), handler)).await
            .map_err(|_| "SFTP connection timed out before authentication")?;
        Self::ensure_current(cancelled)?;
        let fingerprint = observed.lock().await.clone().ok_or_else(|| match &connected {
            Err(error) => format!("SSH connection failed before host-key verification: {error}"),
            Ok(_) => "SSH server did not provide a host key".to_string(),
        })?;
        let verified = verified_key(stored.as_deref(), confirmation.as_deref(), &fingerprint)?;
        if !verified {
            // The Handler returned false: no authenticated session exists.
            if let Ok(session) = connected { let _ = session.disconnect(Disconnect::ByApplication, "Verify host fingerprint", "English").await; }
            self.record_verification(host, target.clone(), fingerprint.clone(), cancelled).await?;
            return Ok(SftpConnectResult::new("verify-host", &target, fingerprint));
        }
        let mut session = connected.map_err(|error| format!("SSH connection failed: {error}"))?;
        let authenticated = async {
            Self::ensure_current(cancelled)?;
            if stored.is_none() {
                let mut hosts = self.known_hosts.lock().await;
                // Another connection might have verified this endpoint while
                // our handshake was in flight; never overwrite a different key.
                verified_key(hosts.get(&endpoint).map(String::as_str), confirmation.as_deref(), &fingerprint)?;
                let mut next = hosts.clone();
                next.insert(endpoint.clone(), fingerprint.clone());
                self.save_known_hosts(&next).await?;
                *hosts = next;
            }
            Self::ensure_current(cancelled)?;
            tokio::time::timeout(Duration::from_secs(45), authenticate(&mut session, &target, &credentials, cancelled)).await
                .map_err(|_| "SFTP authentication timed out")??;
            Self::ensure_current(cancelled)?;
            let sftp = tokio::time::timeout(Duration::from_secs(15), async {
                let channel = session.channel_open_session().await.map_err(|error| format!("SFTP channel failed: {error}"))?;
                channel.request_subsystem(true, "sftp").await.map_err(|error| format!("This SSH server did not accept SFTP: {error}"))?;
                SftpSession::new(channel.into_stream()).await.map_err(|error| format!("SFTP subsystem failed: {error}"))
            }).await.map_err(|_| "SFTP subsystem startup timed out")??;
            Self::ensure_current(cancelled)?;
            Ok::<_, String>(sftp)
        }.await;
        let sftp = match authenticated {
            Ok(sftp) => sftp,
            Err(error) => { let _ = session.disconnect(Disconnect::ByApplication, "Connection cancelled or unavailable", "English").await; return Err(error); }
        };
        let result = SftpConnectResult::new("connected", &target, fingerprint);
        // Serialize installation with disconnect. A late result can never put a
        // cancelled session back after its UI has closed or changed host.
        let pending = self.pending_connections.lock().await;
        if Self::ensure_current(cancelled).is_err() || !pending.get(host).is_some_and(|current| Arc::ptr_eq(current, cancelled)) {
            drop(pending);
            let _ = sftp.close().await;
            let _ = session.disconnect(Disconnect::ByApplication, "Connection cancelled", "English").await;
            return Err("SFTP connection was cancelled".into());
        }
        self.connections.lock().await.insert(host.to_string(), Connection { session, sftp, target, result: result.clone() });
        Ok(result)
    }

    pub async fn disconnect(&self, host: &str) {
        let connection = {
            let mut pending = self.pending_connections.lock().await;
            if let Some(attempt) = pending.remove(host) { attempt.store(true, Ordering::SeqCst); }
            self.pending_verifications.lock().await.remove(host);
            self.connections.lock().await.remove(host)
        };
        if let Some(connection) = connection {
            let _ = connection.sftp.close().await;
            let _ = connection.session.disconnect(Disconnect::ByApplication, "Closed", "English").await;
        }
    }

    /// Explicit trust removal never accepts a replacement fingerprint. Future
    /// connections to this exact canonical endpoint require fresh verification.
    pub async fn forget_host_keys(&self, endpoint: &str) {
        let mut hosts = self.known_hosts.lock().await;
        let mut next = hosts.clone();
        next.remove(endpoint);
        if self.save_known_hosts(&next).await.is_ok() { *hosts = next; }
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

async fn authenticate(
    session: &mut client::Handle<SshClient>, target: &ResolvedTarget,
    credentials: &SftpCredentials, cancelled: &AtomicBool,
) -> Result<(), String> {
    SftpManager::ensure_current(cancelled)?;
    if credentials.password.as_ref().is_some_and(|value| value.len() > 16384)
        || credentials.passphrase.as_ref().is_some_and(|value| value.len() > 16384) {
        return Err("SFTP credentials exceed the supported length".into());
    }
    if target.auth_type == Some(AuthType::Password) {
        let password = credentials.password.as_ref().filter(|value| !value.is_empty())
            .ok_or("Enter the SSH password to connect. Husk does not store it")?;
        return match session.authenticate_password(&target.username, password).await {
            Ok(AuthResult::Success) => Ok(()),
            _ => Err("SSH password authentication was not accepted. Keyboard-interactive/MFA is not supported in SFTP".into()),
        };
    }
    let hash = session.best_supported_rsa_hash().await
        .map_err(|_| "Could not negotiate SSH public-key authentication")?
        .unwrap_or(Some(ssh_key::HashAlg::Sha256));
    let mut agent_error = None;
    if target.auth_type != Some(AuthType::Key) && target.agent_socket.as_deref() != Some("none") {
        match authenticate_agent(session, target, hash, cancelled).await {
            Ok(true) => return Ok(()),
            Ok(false) => agent_error = Some("The SSH agent had no accepted identities"),
            Err(_) => agent_error = Some("The app could not use its SSH agent"),
        }
    }
    if target.auth_type == Some(AuthType::Agent) {
        return Err(format!("{}. Select a different authentication method explicitly; Husk did not try private-key files", agent_error.unwrap_or("The SSH agent is disabled by this configuration")));
    }
    let mut key_load_failed = false;
    let mut attempted = false;
    for key_path in &target.identity_files {
        SftpManager::ensure_current(cancelled)?;
        if !tokio::fs::metadata(key_path).await.is_ok_and(|metadata| metadata.is_file()) { continue; }
        let path = key_path.clone();
        let passphrase = credentials.passphrase.clone();
        let key = tokio::task::spawn_blocking(move || load_secret_key(&path, passphrase.as_deref())).await;
        SftpManager::ensure_current(cancelled)?;
        let Ok(Ok(key)) = key else { key_load_failed = true; continue; };
        attempted = true;
        if matches!(session.authenticate_publickey(&target.username, PrivateKeyWithHashAlg::new(Arc::new(key), hash)).await, Ok(AuthResult::Success)) { return Ok(()); }
    }
    if key_load_failed { return Err("A private key could not be loaded. Check the key file and enter its passphrase, or choose another authentication method".into()); }
    if attempted { return Err("SSH public-key authentication was not accepted. Verify the username and authorized key on the server".into()); }
    Err(format!("{}. No readable private key was available. Choose a key file or password; terminal-only agents and interactive/MFA logins are not reused", agent_error.unwrap_or("No private key was found")))
}

async fn authenticate_agent(
    session: &mut client::Handle<SshClient>, target: &ResolvedTarget,
    hash: Option<ssh_key::HashAlg>, cancelled: &AtomicBool,
) -> Result<bool, String> {
    use russh::keys::agent::{AgentIdentity, client::AgentClient};
    #[cfg(unix)]
    let connected = match target.agent_socket.as_deref() {
        None | Some("SSH_AUTH_SOCK") => AgentClient::connect_env().await,
        Some(path) => AgentClient::connect_uds(path).await,
    };
    #[cfg(windows)]
    let connected = AgentClient::connect_named_pipe(match target.agent_socket.as_deref() {
        None | Some("SSH_AUTH_SOCK") => r"\\.\pipe\openssh-ssh-agent",
        Some(path) => path,
    }).await;
    #[cfg(not(any(unix, windows)))]
    return Err("SSH agent authentication is unavailable on this platform".into());
    #[cfg(any(unix, windows))]
    {
        let mut agent = connected.map_err(|_| "SSH agent unavailable to the app")?;
        let identities = agent.request_identities().await.map_err(|_| "Could not list SSH agent identities")?;
        for identity in identities.into_iter().take(8) {
            SftpManager::ensure_current(cancelled)?;
            let result = match identity {
                AgentIdentity::PublicKey { key, .. } => session.authenticate_publickey_with(&target.username, key, hash, &mut agent).await,
                AgentIdentity::Certificate { certificate, .. } => session.authenticate_certificate_with(&target.username, certificate, hash, &mut agent).await,
            };
            if matches!(result, Ok(AuthResult::Success)) { return Ok(true); }
        }
        Ok(false)
    }
}

#[cfg(test)]
mod connection_lifecycle_tests {
    use super::*;
    fn fixture_target() -> ResolvedTarget {
        ResolvedTarget {
            hostname: "prod.example.test".into(), port: 22, username: "deploy".into(),
            identity_files: vec!["/fixture/key".into()], auth_type: Some(AuthType::Key), agent_socket: None,
        }
    }
    #[test]
    fn disconnect_revokes_pending_connection_before_it_can_install() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let manager = SftpManager::new();
            let (pending, _) = manager.begin_connection("fixture-session", false).await;
            manager.disconnect("fixture-session").await;
            assert!(SftpManager::ensure_current(&pending).is_err());
            assert!(!manager.pending_connections.lock().await.contains_key("fixture-session"));
        });
    }
    #[test]
    fn newer_attempt_revokes_only_the_older_attempt_for_its_session() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let manager = SftpManager::new();
            let (older, _) = manager.begin_connection("one", false).await;
            let (unrelated, _) = manager.begin_connection("two", false).await;
            let (newer, _) = manager.begin_connection("one", false).await;
            assert!(SftpManager::ensure_current(&older).is_err());
            assert!(SftpManager::ensure_current(&newer).is_ok());
            assert!(SftpManager::ensure_current(&unrelated).is_ok());
        });
    }
    #[test]
    fn confirmation_requires_the_exact_reviewed_target_not_just_a_reused_key() {
        let target = fixture_target();
        let verification = PendingHostVerification { target: target.clone(), fingerprint: "SHA256:fixture".into() };
        assert!(SftpManager::check_confirmation(&target, Some("SHA256:fixture"), None).is_err());
        assert!(SftpManager::check_confirmation(&target, Some("SHA256:fixture"), Some(&verification)).is_ok());
        assert!(SftpManager::check_confirmation(&target, Some("SHA256:other"), Some(&verification)).is_err());
        let mut changes = Vec::new();
        let mut changed = target.clone(); changed.hostname = "other.example.test".into(); changes.push(changed);
        let mut changed = target.clone(); changed.port = 2222; changes.push(changed);
        let mut changed = target.clone(); changed.username = "root".into(); changes.push(changed);
        let mut changed = target.clone(); changed.identity_files = vec!["/fixture/other-key".into()]; changes.push(changed);
        let mut changed = target.clone(); changed.auth_type = Some(AuthType::Agent); changes.push(changed);
        let mut changed = target.clone(); changed.agent_socket = Some("/fixture/agent".into()); changes.push(changed);
        for changed in changes {
            assert!(SftpManager::check_confirmation(&changed, Some("SHA256:fixture"), Some(&verification)).is_err(), "{changed:?}");
        }
    }
    #[test]
    fn completed_challenge_is_retained_then_consumed_once_by_confirmation() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let manager = SftpManager::new(); let target = fixture_target();
            let (first, _) = manager.begin_connection("one", false).await;
            manager.record_verification("one", target.clone(), "SHA256:fixture".into(), &first).await.unwrap();
            manager.finish_connection("one", &first, true).await;
            assert!(!manager.pending_connections.lock().await.contains_key("one"));
            assert!(manager.pending_verifications.lock().await.contains_key("one"));
            let (confirming, verification) = manager.begin_connection("one", true).await;
            assert!(SftpManager::check_confirmation(&target, Some("SHA256:fixture"), verification.as_ref()).is_ok());
            assert!(!manager.pending_verifications.lock().await.contains_key("one"));
            manager.finish_connection("one", &confirming, false).await;
            let (_, repeated) = manager.begin_connection("one", true).await;
            assert!(SftpManager::check_confirmation(&target, Some("SHA256:fixture"), repeated.as_ref()).is_err());
        });
    }
    #[test]
    fn fresh_attempt_and_disconnect_revoke_previous_verifications() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let manager = SftpManager::new(); let target = fixture_target();
            let (first, _) = manager.begin_connection("one", false).await;
            manager.record_verification("one", target.clone(), "SHA256:fixture".into(), &first).await.unwrap();
            manager.finish_connection("one", &first, true).await;
            let (second, old_verification) = manager.begin_connection("one", false).await;
            assert!(old_verification.is_none());
            assert!(!manager.pending_verifications.lock().await.contains_key("one"));
            manager.record_verification("one", target.clone(), "SHA256:fixture".into(), &second).await.unwrap();
            manager.finish_connection("one", &second, true).await;
            manager.disconnect("one").await;
            assert!(!manager.pending_verifications.lock().await.contains_key("one"));
            assert!(manager.record_verification("one", target, "SHA256:fixture".into(), &second).await.is_err());
        });
    }
    #[test]
    fn stale_generation_cannot_restore_or_clear_a_newer_challenge() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let manager = SftpManager::new(); let target = fixture_target();
            let (older, _) = manager.begin_connection("one", false).await;
            let (newer, _) = manager.begin_connection("one", false).await;
            assert!(manager.record_verification("one", target.clone(), "SHA256:older".into(), &older).await.is_err());
            manager.record_verification("one", target, "SHA256:newer".into(), &newer).await.unwrap();
            manager.finish_connection("one", &older, false).await;
            assert_eq!(manager.pending_verifications.lock().await.get("one").unwrap().fingerprint, "SHA256:newer");
            manager.finish_connection("one", &newer, false).await;
            assert!(!manager.pending_verifications.lock().await.contains_key("one"));
        });
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
    validate_remote_target(path)?;
    path.trim_end_matches('/')
        .rsplit('/')
        .find(|part| !part.is_empty())
        .ok_or_else(|| "The remote path has no file name".to_string())
}

fn validate_remote_target(path: &str) -> Result<(), String> {
    if path.contains("//") { return Err("Repeated path separators are not allowed".into()); }
    // Listings start at the authenticated user's home ("."). Permit a leading
    // ./ for its children, never the home itself or traversal inside a path.
    let path = path.strip_prefix("./").unwrap_or(path);
    let parts: Vec<_> = path.split('/').filter(|part| !part.is_empty()).collect();
    if path.contains('\0') || path.contains("//") || parts.is_empty() || parts.iter().any(|part| *part == "." || *part == "..") {
        return Err("Choose a specific path; root, dot and parent-directory targets are not allowed".to_string());
    }
    Ok(())
}

fn validate_local_target(path: &Path) -> Result<(), String> {
    let value = path.to_string_lossy();
    if path.file_name().is_none() || value.contains('\0') || value.split(std::path::MAIN_SEPARATOR).any(|part| part == "." || part == "..") {
        return Err("Choose a specific local path without dot or parent-directory components".to_string());
    }
    Ok(())
}

fn validate_child_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
        return Err("Unsafe entry name in directory listing".to_string());
    }
    Ok(())
}

fn validate_transfer_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') {
        return Err("Invalid transfer identifier".to_string());
    }
    Ok(())
}

fn transfer_nonce() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    format!("{}-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos(), NEXT.fetch_add(1, Ordering::Relaxed))
}

fn optional_remote_metadata(result: Result<russh_sftp::protocol::FileAttributes, russh_sftp::client::error::Error>) -> Result<Option<russh_sftp::protocol::FileAttributes>, String> {
    match result {
        Ok(metadata) => Ok(Some(metadata)),
        Err(russh_sftp::client::error::Error::Status(status)) if status.status_code == russh_sftp::protocol::StatusCode::NoSuchFile => Ok(None),
        Err(error) => Err(format!("SFTP destination check failed: {error}")),
    }
}

async fn remote_metadata(sftp: &SftpSession, path: &str) -> Result<Option<russh_sftp::protocol::FileAttributes>, String> {
    optional_remote_metadata(sftp.symlink_metadata(path).await)
}

async fn local_metadata(path: &Path) -> Result<Option<std::fs::Metadata>, String> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Local destination check failed: {error}")),
    }
}

fn check_file_destination(exists: bool, regular_file: bool, allow_overwrite: bool) -> Result<(), String> {
    if exists && !regular_file {
        return Err("The destination is not a regular file. Files cannot replace folders or symbolic links.".to_string());
    }
    if exists && !allow_overwrite {
        return Err("Destination already exists. Confirm replacement or choose another name.".to_string());
    }
    Ok(())
}

async fn check_remote_file_destination(sftp: &SftpSession, path: &str, allow_overwrite: bool) -> Result<(), String> {
    validate_remote_target(path)?;
    let metadata = remote_metadata(sftp, path).await?;
    check_file_destination(metadata.is_some(), metadata.as_ref().map(|meta| meta.file_type().is_file()).unwrap_or(false), allow_overwrite)
}

async fn check_local_file_destination(path: &Path, allow_overwrite: bool) -> Result<(), String> {
    validate_local_target(path)?;
    let metadata = local_metadata(path).await?;
    check_file_destination(metadata.is_some(), metadata.as_ref().map(|meta| meta.is_file()).unwrap_or(false), allow_overwrite)
}

async fn finalize_local_file(staging: &Path, destination: &Path, allow_overwrite: bool) -> Result<(), String> {
    check_local_file_destination(destination, allow_overwrite).await?;
    if allow_overwrite {
        // Never unlink the original before replacement. On platforms that do
        // not support replacement rename, fail with both files intact.
        tokio::fs::rename(staging, destination).await.map_err(|error| format!("Local file finalize failed; original preserved: {error}"))?;
    } else {
        // Same-directory hard link is an atomic no-clobber commit, unlike
        // an exists-check followed by a replacement-capable rename.
        tokio::fs::hard_link(staging, destination).await.map_err(|error| format!("Local no-overwrite finalize failed: {error}"))?;
        tokio::fs::remove_file(staging).await.map_err(|error| format!("Transfer completed; staging file remains: {error}"))?;
    }
    Ok(())
}

// SFTP v3 rename is no-clobber. For explicitly approved replacement, retain
// the original under a unique sibling name until finalization has succeeded.
async fn finalize_remote_file(sftp: &mut SftpSession, staging: &str, destination: &str, allow_overwrite: bool) -> Result<(), String> {
    validate_remote_target(destination)?;
    let metadata = remote_metadata(sftp, destination).await?;
    check_file_destination(metadata.is_some(), metadata.as_ref().map(|meta| meta.file_type().is_file()).unwrap_or(false), allow_overwrite)?;
    let backup = if metadata.is_some() {
        let backup = format!("{destination}.husk-backup-{}", transfer_nonce());
        sftp.rename(destination, &backup).await.map_err(|error| format!("SFTP preserve original failed: {error}"))?;
        Some(backup)
    } else { None };
    if let Err(error) = sftp.rename(staging, destination).await {
        if let Some(backup) = &backup {
            if let Err(restore_error) = sftp.rename(backup, destination).await {
                return Err(format!("SFTP finalize failed: {error}. Original retained at {backup}; restore failed: {restore_error}"));
            }
        }
        return Err(format!("SFTP finalize failed; original preserved: {error}"));
    }
    if let Some(backup) = backup {
        sftp.remove_file(&backup).await.map_err(|error| format!("Transfer completed, but original backup remains at {backup}: {error}"))?;
    }
    Ok(())
}

async fn copy_remote_file(sftp: &mut SftpSession, from: &str, to: &str, allow_overwrite: bool) -> Result<(), String> {
    check_remote_file_destination(sftp, to, allow_overwrite).await?;
    let staging = remote_staging_path(to, &transfer_nonce());
    let mut source = sftp
        .open(from)
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?;
    let mut destination = sftp
        .open_with_flags(&staging, OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE)
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
    destination.sync_all().await.map_err(|error| format!("SFTP sync failed: {error}"))?;
    drop(destination);
    finalize_remote_file(sftp, &staging, to, allow_overwrite).await
}

async fn copy_remote_path(sftp: &mut SftpSession, from: &str, to: &str, allow_overwrite: bool) -> Result<(), String> {
    validate_remote_target(from)?;
    validate_remote_target(to)?;
    if from == to {
        return Err("Choose a different destination to copy this item".to_string());
    }

    let source_meta = sftp
        .symlink_metadata(from)
        .await
        .map_err(|e| format!("SFTP stat failed: {}", e))?;

    if source_meta.file_type().is_file() {
        return copy_remote_file(sftp, from, to, allow_overwrite).await;
    }
    if !source_meta.file_type().is_dir() { return Err("Only regular files and folders can be copied".to_string()); }

    let source_root = sftp.canonicalize(from).await.map_err(|error| format!("Source path check failed: {error}"))?;
    let parent = to.rsplit_once('/').map(|(parent, _)| if parent.is_empty() { "/" } else { parent }).unwrap_or(".");
    let target_parent = sftp.canonicalize(parent).await.map_err(|error| format!("Destination path check failed: {error}"))?;
    let destination_root = remote_join(&target_parent, remote_basename(to)?);
    if source_root == "/" || source_root == destination_root || destination_root.starts_with(&format!("{}/", source_root)) || source_root.starts_with(&format!("{}/", destination_root)) {
        return Err("Source and destination folders cannot overlap".to_string());
    }

    if remote_metadata(sftp, to).await?.is_some() && !allow_overwrite { return Err("Destination folder already exists. Confirm merge or choose another name.".to_string()); }
    ensure_remote_directory(sftp, to).await?;

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
            validate_child_name(&name)?;
            let source_child = remote_join(&source_dir, &name);
            let destination_child = remote_join(&destination_dir, &name);
            if entry.metadata().file_type().is_dir() {
                ensure_remote_directory(sftp, &destination_child).await?;
                pending.push((source_child, destination_child));
            } else if entry.metadata().file_type().is_file() {
                copy_remote_file(sftp, &source_child, &destination_child, allow_overwrite).await?;
            } else {
                return Err("Copying symbolic links and special files is not supported".to_string());
            }
        }
    }
    Ok(())
}

async fn delete_remote_tree(sftp: &mut SftpSession, path: &str) -> Result<(), String> {
    validate_remote_target(path)?;
    let meta = sftp
        .symlink_metadata(path)
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
            validate_child_name(&name)?;
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
    validate_local_target(local_path)?;
    validate_transfer_id(transfer_id)?;
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

async fn verify_resume_prefix<A: tokio::io::AsyncRead + Unpin, B: tokio::io::AsyncRead + Unpin>(source: &mut A, staging: &mut B, length: u64, cancelled: &AtomicBool) -> Result<(), String> {
    let mut remaining = length;
    let mut source_buffer = vec![0; 65536];
    let mut staging_buffer = vec![0; 65536];
    while remaining > 0 {
        ensure_not_cancelled(cancelled)?;
        let count = remaining.min(65536) as usize;
        source.read_exact(&mut source_buffer[..count]).await.map_err(|error| format!("Resume source check failed: {error}"))?;
        staging.read_exact(&mut staging_buffer[..count]).await.map_err(|error| format!("Resume staging check failed: {error}"))?;
        if source_buffer[..count] != staging_buffer[..count] { return Err("The source changed since this transfer paused. Start a new transfer; the destination has not been replaced.".to_string()); }
        remaining -= count as u64;
    }
    Ok(())
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
    allow_overwrite: bool,
) -> Result<(), String> {
    ensure_not_cancelled(cancelled)?;
    validate_transfer_id(transfer_id)?;
    validate_remote_target(remote_path)?;
    check_local_file_destination(local_path, allow_overwrite).await?;
    let meta = sftp
        .symlink_metadata(remote_path)
        .await
        .map_err(|e| format!("SFTP stat failed: {}", e))?;
    if !meta.file_type().is_file() { return Err("Only regular files can be downloaded as files".to_string()); }
    let total_size = meta.len();
    let staging_path = local_staging_path(local_path, transfer_id)?;
    let staging_metadata = local_metadata(&staging_path).await?;
    if staging_metadata.as_ref().map(|metadata| !metadata.is_file()).unwrap_or(false) { return Err("The staging path is not a regular file".to_string()); }
    if staging_metadata.is_some() && !resume { return Err("A staging file already exists. Explicitly resume this transfer or start a new one.".to_string()); }
    let mut copied = staging_metadata.as_ref().map(|metadata| metadata.len()).unwrap_or(0);
    if copied > total_size { return Err("Source is smaller than the staged transfer. Start a new transfer.".to_string()); }

    let mut remote = sftp
        .open(remote_path)
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?;
    let mut local_options = tokio::fs::OpenOptions::new();
    local_options.write(true).read(true);
    if staging_metadata.is_none() { local_options.create_new(true); }
    #[cfg(unix)]
    local_options.custom_flags(libc::O_NOFOLLOW);
    let mut local = local_options
        .open(&staging_path)
        .await
        .map_err(|e| format!("Local file create failed: {}", e))?;
    if copied > 0 {
        verify_resume_prefix(&mut remote, &mut local, copied, cancelled).await?;
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
    finalize_local_file(&staging_path, local_path, allow_overwrite).await
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
    allow_overwrite: bool,
) -> Result<(), String> {
    ensure_not_cancelled(cancelled)?;
    validate_transfer_id(transfer_id)?;
    validate_local_target(local_path)?;
    check_remote_file_destination(sftp, remote_path, allow_overwrite).await?;
    let source_metadata = tokio::fs::symlink_metadata(local_path)
        .await
        .map_err(|error| format!("Local source check failed: {error}"))?;
    if !source_metadata.is_file() { return Err("Only regular files can be uploaded as files".to_string()); }
    let total_size = source_metadata.len();
    let staging_path = remote_staging_path(remote_path, transfer_id);
    let staging_metadata = remote_metadata(sftp, &staging_path).await?;
    if staging_metadata.as_ref().map(|metadata| !metadata.file_type().is_file()).unwrap_or(false) { return Err("The staging path is not a regular file".to_string()); }
    if staging_metadata.is_some() && !resume { return Err("A staging file already exists. Explicitly resume this transfer or start a new one.".to_string()); }
    let mut copied = staging_metadata.as_ref().map(|metadata| metadata.len()).unwrap_or(0);
    if copied > total_size { return Err("Source is smaller than the staged transfer. Start a new transfer.".to_string()); }
    let mut local = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| format!("Local file open failed: {}", e))?;
    let mut remote = if staging_metadata.is_some() {
        sftp.open_with_flags(
            &staging_path,
            OpenFlags::WRITE | OpenFlags::READ,
        )
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?
    } else {
        sftp.open_with_flags(&staging_path, OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE | OpenFlags::READ)
            .await
            .map_err(|e| format!("SFTP create failed: {}", e))?
    };
    if copied > 0 {
        verify_resume_prefix(&mut local, &mut remote, copied, cancelled).await?;
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
    finalize_remote_file(sftp, &staging_path, remote_path, allow_overwrite).await
}

/// Merge only directories. A file/symlink is never implicitly removed to make
/// room for a directory, including during an explicitly approved file merge.
async fn ensure_remote_directory(sftp: &mut SftpSession, path: &str) -> Result<(), String> {
    validate_remote_target(path)?;
    match remote_metadata(sftp, path).await? {
        Some(metadata) if metadata.file_type().is_dir() => Ok(()),
        Some(_) => Err("A directory cannot replace an existing file or symbolic link".to_string()),
        None => sftp
            .create_dir(path)
            .await
            .map_err(|e| format!("SFTP mkdir failed: {}", e)),
    }
}

async fn ensure_local_directory(path: &Path) -> Result<(), String> {
    validate_local_target(path)?;
    match local_metadata(path).await? {
        Some(metadata) if metadata.is_dir() => Ok(()),
        Some(_) => Err("A directory cannot replace an existing file or symbolic link".to_string()),
        None => tokio::fs::create_dir(path).await.map_err(|error| format!("Local folder create failed: {error}")),
    }
}

#[tauri::command]
pub async fn sftp_connect(
    host: String,
    target: Option<SftpTarget>,
    credentials: Option<SftpCredentials>,
    expected_fingerprint: Option<String>,
    manager: State<'_, SftpManager>,
) -> Result<SftpConnectResult, String> {
    manager.connect(&host, target, credentials, expected_fingerprint).await
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
    allow_overwrite: Option<bool>,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    validate_transfer_id(&transfer_id)?;
    let cancelled = manager.begin_transfer(&transfer_id).await;
    let result = async {
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
            allow_overwrite.unwrap_or(false),
        )
        .await
    }.await;
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
    allow_overwrite: Option<bool>,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    validate_transfer_id(&transfer_id)?;
    let allow_overwrite = allow_overwrite.unwrap_or(false);
    let destination = PathBuf::from(local_parent).join(remote_basename(&remote_path)?);
    validate_local_target(&destination)?;
    let cancelled = manager.begin_transfer(&transfer_id).await;
    let result = async {
        let mut conns = manager.connections.lock().await;
        let conn = conns
            .get_mut(&host)
            .ok_or_else(|| "Not connected".to_string())?;
        if local_metadata(&destination).await?.is_some() && !resume && !allow_overwrite {
            return Err("Destination folder already exists. Confirm merge or choose another name.".to_string());
        }
        ensure_local_directory(&destination).await?;

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
                validate_child_name(&name)?;
                let remote_child = remote_join(&remote_dir, &name);
                let local_child = local_dir.join(&name);
                if entry.metadata().file_type().is_dir() {
                    ensure_local_directory(&local_child).await?;
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
                        allow_overwrite,
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
    allow_overwrite: Option<bool>,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    validate_transfer_id(&transfer_id)?;
    let cancelled = manager.begin_transfer(&transfer_id).await;
    let result = async {
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
            allow_overwrite.unwrap_or(false),
        )
        .await
    }.await;
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
    allow_overwrite: Option<bool>,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    validate_transfer_id(&transfer_id)?;
    let allow_overwrite = allow_overwrite.unwrap_or(false);
    if conflict_mode != "merge" && conflict_mode != "replace" {
        return Err("Unsupported folder conflict mode".to_string());
    }
    if conflict_mode == "replace" && !allow_overwrite { return Err("Replacing a folder requires explicit replacement approval".to_string()); }
    let local_root = PathBuf::from(&local_path);
    validate_local_target(&local_root)?;
    if !tokio::fs::symlink_metadata(&local_root).await.map_err(|error| format!("Local folder check failed: {error}"))?.is_dir() { return Err("Choose a regular local directory".to_string()); }
    let name = local_root
        .file_name()
        .and_then(|part| part.to_str())
        .filter(|part| !part.is_empty())
        .ok_or_else(|| "The local folder has no name".to_string())?;
    let remote_root = remote_join(&remote_parent, name);
    validate_remote_target(&remote_root)?;
    let cancelled = manager.begin_transfer(&transfer_id).await;
    let result = async {
        let mut conns = manager.connections.lock().await;
        let conn = conns
            .get_mut(&host)
            .ok_or_else(|| "Not connected".to_string())?;
        // A replacement applies only to the initial attempt. Retrying or
        // resuming must retain staged partial data, so it merges the remaining
        // local tree into whatever the first attempt already created.
        if !resume && conflict_mode == "replace" {
            if let Some(metadata) = remote_metadata(&conn.sftp, &remote_root).await? {
                if !metadata.file_type().is_dir() { return Err("Folder replacement cannot remove a file or symbolic link".to_string()); }
                delete_remote_tree(&mut conn.sftp, &remote_root).await?;
            }
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
                validate_child_name(&name)?;
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
                        allow_overwrite,
                    )
                    .await?;
                } else {
                    return Err("Uploading symbolic links and special files is not supported".to_string());
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
    allow_overwrite: Option<bool>,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let mut conns = manager.connections.lock().await;
    let conn = conns
        .get_mut(&host)
        .ok_or_else(|| "Not connected".to_string())?;
    copy_remote_path(&mut conn.sftp, &from, &to, allow_overwrite.unwrap_or(false)).await
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
    validate_remote_target(&path)?;
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
    allow_overwrite: Option<bool>,
    manager: State<'_, SftpManager>,
) -> Result<(), String> {
    validate_remote_target(&from)?;
    validate_remote_target(&to)?;
    if from.trim_end_matches('/') == to.trim_end_matches('/') { return Err("Choose a different destination".to_string()); }
    let mut conns = manager.connections.lock().await;
    let conn = conns
        .get_mut(&host)
        .ok_or_else(|| "Not connected".to_string())?;
    let source = remote_metadata(&conn.sftp, &from).await?.ok_or_else(|| "Source does not exist".to_string())?;
    if source.file_type().is_file() {
        return finalize_remote_file(&mut conn.sftp, &from, &to, allow_overwrite.unwrap_or(false)).await;
    }
    if remote_metadata(&conn.sftp, &to).await?.is_some() { return Err("Destination already exists. Folder and symbolic-link renames require a new destination.".to_string()); }
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
    validate_remote_target(&path)?;
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
    validate_remote_target(&path)?;
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
    use super::{check_file_destination, ensure_not_cancelled, finalize_local_file, local_staging_path, optional_remote_metadata, remote_staging_path, transfer_nonce, validate_child_name, validate_local_target, validate_remote_target, verify_resume_prefix};
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
        assert_eq!(
            ensure_not_cancelled(&cancelled),
            Err("Transfer cancelled".to_string())
        );
    }

    #[test]
    fn refuses_broad_and_traversing_transfer_targets() {
        for target in ["", "/", "//", ".", "./", "./../file", ".//file", "..", "/srv/.", "/srv/..", "/srv/../data", "/srv//data", "/srv/\0bad"] {
            assert!(validate_remote_target(target).is_err(), "{target:?}");
        }
        for target in ["/srv/report.txt", "report.txt", "./report.txt", "./folder/file.txt", "/srv/space name/"] { assert!(validate_remote_target(target).is_ok()); }
        for target in ["/", ".", "..", "/tmp/.", "/tmp/../file"] { assert!(validate_local_target(Path::new(target)).is_err(), "{target}"); }
        for child in ["", ".", "..", "../escape", "nested/file", "nested\\file", "a\0b"] { assert!(validate_child_name(child).is_err()); }
        assert!(validate_child_name("normal file.txt").is_ok());
        assert!(local_staging_path(Path::new("/tmp/file"), "../escape").is_err());
    }

    #[test]
    fn only_explicit_regular_file_replacement_is_allowed() {
        assert!(check_file_destination(false, false, false).is_ok());
        assert!(check_file_destination(true, true, false).is_err());
        assert!(check_file_destination(true, true, true).is_ok());
        assert!(check_file_destination(true, false, false).is_err());
        assert!(check_file_destination(true, false, true).is_err());
    }

    #[test]
    fn denied_stat_is_never_treated_as_an_absent_destination() {
        use russh_sftp::{client::error::Error, protocol::{Status, StatusCode}};
        let error = |code| Err(Error::Status(Status { id: 1, status_code: code, error_message: "fixture".into(), language_tag: "en".into() }));
        assert!(optional_remote_metadata(error(StatusCode::NoSuchFile)).unwrap().is_none());
        for code in [StatusCode::PermissionDenied, StatusCode::Failure, StatusCode::ConnectionLost, StatusCode::OpUnsupported] {
            assert!(optional_remote_metadata(error(code)).is_err());
        }
        assert!(optional_remote_metadata(Err(Error::Timeout)).is_err());
    }

    #[tokio::test]
    async fn resumed_bytes_must_match_source_instead_of_only_matching_length() {
        let cancelled = AtomicBool::new(false);
        let mut source = &b"same-prefix-more-data"[..];
        let mut staged = &b"same-prefix"[..];
        assert!(verify_resume_prefix(&mut source, &mut staged, 11, &cancelled).await.is_ok());
        let mut source = &b"new-data"[..];
        let mut staged = &b"old-data"[..];
        assert!(verify_resume_prefix(&mut source, &mut staged, 8, &cancelled).await.unwrap_err().contains("source changed"));
        let mut source = &b"short"[..];
        let mut staged = &b"short-plus"[..];
        assert!(verify_resume_prefix(&mut source, &mut staged, 10, &cancelled).await.is_err());
    }

    #[tokio::test]
    async fn local_finalization_never_clobbers_without_explicit_approval() {
        let fixture = std::env::temp_dir().join(format!("husk-sftp-finalize-{}", transfer_nonce()));
        tokio::fs::create_dir(&fixture).await.unwrap();
        let staging = fixture.join("transfer.part");
        let destination = fixture.join("target.txt");
        tokio::fs::write(&staging, "replacement").await.unwrap();
        tokio::fs::write(&destination, "original").await.unwrap();
        assert!(finalize_local_file(&staging, &destination, false).await.is_err());
        assert_eq!(tokio::fs::read_to_string(&destination).await.unwrap(), "original");
        assert_eq!(tokio::fs::read_to_string(&staging).await.unwrap(), "replacement");
        let fresh = fixture.join("fresh.txt");
        finalize_local_file(&staging, &fresh, false).await.unwrap();
        assert_eq!(tokio::fs::read_to_string(&fresh).await.unwrap(), "replacement");
        assert!(!staging.exists());
        let directory = fixture.join("directory");
        tokio::fs::create_dir(&directory).await.unwrap();
        tokio::fs::write(&staging, "new").await.unwrap();
        assert!(finalize_local_file(&staging, &directory, true).await.is_err());
        assert!(directory.is_dir());
        #[cfg(unix)] {
            let link = fixture.join("link");
            std::os::unix::fs::symlink(&destination, &link).unwrap();
            assert!(finalize_local_file(&staging, &link, true).await.is_err());
            assert_eq!(tokio::fs::read_to_string(&destination).await.unwrap(), "original");
            finalize_local_file(&staging, &destination, true).await.unwrap();
            assert_eq!(tokio::fs::read_to_string(&destination).await.unwrap(), "new");
        }
        tokio::fs::remove_dir_all(&fixture).await.unwrap();
    }
}
