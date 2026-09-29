//! Bounded SSH target resolution without executing `ssh -G`, shell commands,
//! Match exec, or authentication plugins. Secrets are never part of identity.
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SftpTarget {
    pub host: String,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub auth_type: Option<AuthType>,
    pub jump_host: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthType { Agent, Key, Password }

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SftpCredentials {
    pub password: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedTarget {
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub identity_files: Vec<String>,
    pub auth_type: Option<AuthType>,
    pub agent_socket: Option<String>,
}

impl ResolvedTarget {
    pub fn endpoint(&self) -> String { format!("[{}]:{}", self.hostname.to_ascii_lowercase(), self.port) }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpConnectResult {
    pub status: &'static str,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub fingerprint: String,
}

impl SftpConnectResult {
    pub fn new(status: &'static str, target: &ResolvedTarget, fingerprint: String) -> Self {
        Self { status, hostname: target.hostname.clone(), port: target.port, username: target.username.clone(), fingerprint }
    }
}

pub fn validate_session_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 1024 || key.chars().any(char::is_control) {
        return Err("Invalid SFTP connection identifier".into());
    }
    Ok(())
}

fn valid_host(host: &str) -> bool {
    !host.is_empty() && host.len() <= 253 && !host.starts_with('-')
        && host.chars().all(|c| c.is_ascii_alphanumeric() || "._-:".contains(c))
        && (!host.contains(':') || host.parse::<std::net::Ipv6Addr>().is_ok())
}

fn valid_user(user: &str) -> bool {
    !user.is_empty() && user.len() <= 256 && !user.starts_with('-')
        && !user.chars().any(|c| c.is_control() || c.is_whitespace() || c == '@')
}

/// Glob subset used by SSH Host patterns and Include basenames, not a shell.
fn pattern_matches(pattern: &str, value: &str) -> bool {
    let pattern = pattern.to_ascii_lowercase(); let value = value.to_ascii_lowercase();
    filename_pattern_matches(&pattern, &value)
}

fn filename_pattern_matches(pattern: &str, value: &str) -> bool {
    let (p, v) = (pattern.as_bytes(), value.as_bytes());
    let (mut pi, mut vi, mut star, mut retry) = (0, 0, None, 0);
    while vi < v.len() {
        if pi < p.len() && (p[pi] == b'?' || p[pi] == v[vi]) { pi += 1; vi += 1; }
        else if pi < p.len() && p[pi] == b'*' { star = Some(pi); pi += 1; retry = vi; }
        else if let Some(index) = star { retry += 1; vi = retry; pi = index + 1; }
        else { return false; }
    }
    while pi < p.len() && p[pi] == b'*' { pi += 1; }
    pi == p.len()
}

fn host_block_matches(patterns: &[String], host: &str) -> bool {
    let mut matched = false;
    for pattern in patterns {
        if let Some(excluded) = pattern.strip_prefix('!') {
            if pattern_matches(excluded, host) { return false; }
        } else if pattern_matches(pattern, host) { matched = true; }
    }
    matched
}

fn config_tokens(line: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new(); let mut current = String::new();
    let (mut quote, mut escape) = (None, false);
    for c in line.chars() {
        if escape { current.push(c); escape = false; continue; }
        if c == '\\' { escape = true; continue; }
        if let Some(q) = quote {
            if c == q { quote = None; } else { current.push(c); }
        } else if c == '\'' || c == '"' { quote = Some(c); }
        else if c == '#' { break; }
        else if c.is_whitespace() || (c == '=' && (tokens.is_empty() || (tokens.len() == 1 && current.is_empty()))) {
            if !current.is_empty() { tokens.push(std::mem::take(&mut current)); }
        } else { current.push(c); }
    }
    if escape || quote.is_some() { return Err("Malformed SSH config quoting; fix the config before connecting".into()); }
    if !current.is_empty() { tokens.push(current); }
    Ok(tokens)
}

#[derive(Default)]
struct ConfigValues { scalar: HashMap<String, String>, identities: Vec<String> }

fn parse_config(
    text: &str, host: &str, active: &mut bool, values: &mut ConfigValues,
    include_base: &Path, includes: &mut impl FnMut(&str, &Path) -> Result<Vec<String>, String>,
    depth: usize, file_count: &mut usize,
) -> Result<(), String> {
    if depth > 8 || text.len() > 1024 * 1024 { return Err("SSH config exceeds SFTP parsing limits".into()); }
    *file_count += 1;
    if *file_count > 32 { return Err("SSH config exceeds the 32-file SFTP limit".into()); }
    for line in text.lines() {
        let tokens = config_tokens(line)?;
        let Some(key) = tokens.first().map(|s| s.to_ascii_lowercase()) else { continue; };
        if key == "host" {
            if tokens.len() < 2 { return Err("SSH config Host needs a pattern".into()); }
            *active = host_block_matches(&tokens[1..], host); continue;
        }
        if key == "match" {
            return Err("SFTP does not evaluate SSH config Match rules. Use a simple Host entry without Match/exec rules; no command was run".into());
        }
        if !*active { continue; }
        if key == "include" {
            if tokens.len() < 2 { return Err("SSH config Include needs a path".into()); }
            for path in &tokens[1..] { for included in includes(path, include_base)? {
                parse_config(&included, host, active, values, include_base, includes, depth + 1, file_count)?;
            } }
            continue;
        }
        match key.as_str() {
            "identityfile" => {
                let value = single_config_value(&tokens)?;
                if !values.identities.iter().any(|identity| identity == value) {
                    if values.identities.len() >= 16 { return Err("SSH config exceeds the 16-identity SFTP limit".into()); }
                    values.identities.push(value.to_string());
                }
            },
            "hostname" | "port" | "user" | "identityagent" | "proxyjump" | "proxycommand"
                | "canonicalizehostname" | "certificatefile" | "pkcs11provider"
                | "identitiesonly" | "preferredauthentications" | "pubkeyauthentication"
                | "passwordauthentication" | "kbdinteractiveauthentication" | "challengeresponseauthentication"
                | "gssapiauthentication" | "hostbasedauthentication" | "securitykeyprovider"
                | "proxyusefdpass" | "bindaddress" | "bindinterface" | "controlmaster"
                | "controlpath" | "hostkeyalias" | "hostkeyalgorithms" | "casignaturealgorithms"
                | "kexalgorithms" | "ciphers" | "macs" | "requiredrsasize" | "rekeylimit" => {
                // ProxyCommand has its own argument syntax. It is never executed, but must
                // still be recorded so an unsupported route cannot become a direct one.
                let value = if key == "proxycommand" {
                    if tokens.len() < 2 { return Err("SSH config ProxyCommand needs a value".into()); }
                    tokens[1..].join(" ")
                } else { single_config_value(&tokens)?.to_string() };
                values.scalar.entry(key).or_insert(value);
            }
            _ => {}
        }
    }
    Ok(())
}

fn single_config_value(tokens: &[String]) -> Result<&str, String> {
    if tokens.len() != 2 || tokens[1].is_empty() {
        return Err(format!("SSH config {} needs exactly one value", tokens[0]));
    }
    Ok(&tokens[1])
}

fn expand_home(value: &str, home: &Path) -> Result<PathBuf, String> {
    if value.contains('%') || value.contains('$') { return Err("SFTP cannot safely expand tokens in this SSH config path".into()); }
    if value == "~" { return Ok(home.to_path_buf()); }
    if let Some(relative) = value.strip_prefix("~/") { return Ok(home.join(relative)); }
    if value.starts_with('~') { return Err("SFTP supports ~/ paths, not another user's ~name paths".into()); }
    Ok(PathBuf::from(value))
}

fn read_bounded(path: &Path) -> Result<Option<String>, String> {
    use std::io::Read;
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Could not inspect SSH config; check its file permissions".into()),
    };
    if !metadata.is_file() { return Err("SSH config must be a regular file".into()); }
    if metadata.len() > 1024 * 1024 { return Err("SSH config exceeds the 1 MiB SFTP limit".into()); }
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Could not read SSH config; check its file permissions".into()),
    };
    let mut bytes = Vec::new();
    file.take(1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| "Could not read SSH config")?;
    if bytes.len() > 1024 * 1024 { return Err("SSH config exceeds the 1 MiB SFTP limit".into()); }
    String::from_utf8(bytes).map(Some).map_err(|_| "SSH config is not UTF-8 text".into())
}

pub fn resolve_target(target: SftpTarget) -> Result<ResolvedTarget, String> {
    let home = dirs::home_dir().ok_or("Could not locate the local home directory")?;
    let user_base = home.join(".ssh");
    #[cfg(not(windows))]
    let system_base = PathBuf::from("/etc/ssh");
    #[cfg(windows)]
    let system_base = std::env::var_os("ProgramData").map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData")).join("ssh");
    let user_config = read_bounded(&user_base.join("config"))?.unwrap_or_default();
    let system_config = read_bounded(&system_base.join("ssh_config"))?.unwrap_or_default();
    let local_user = whoami::username().map_err(|_| "Could not determine the local SSH username")?;
    // Reading and parsing both enforce a shared bound across the user config,
    // system config and their includes. No shell or SSH helper is invoked.
    let mut count = 2;
    let mut include = |value: &str, include_base: &Path| -> Result<Vec<String>, String> {
        let path = expand_home(value, &home)?;
        let path = if path.is_absolute() { path } else { include_base.join(path) };
        let name = path.file_name().and_then(|s| s.to_str()).ok_or("Invalid SSH config Include path")?;
        let parent = path.parent().ok_or("Invalid SSH config Include path")?;
        if parent.to_string_lossy().contains(['*', '?', '[', ']']) || name.contains(['[', ']']) {
            return Err("SFTP supports SSH Include wildcards only in the final filename (* and ?)".into());
        }
        let mut paths = if name.contains(['*', '?']) {
            match std::fs::read_dir(parent) {
                Ok(entries) => {
                    let mut paths = Vec::new();
                    for entry in entries {
                        let entry = entry.map_err(|_| "Could not read SSH config Include entry")?;
                        if filename_pattern_matches(name, &entry.file_name().to_string_lossy()) {
                            if paths.len() >= 32 - count { return Err("SSH config includes exceed the 32-file SFTP limit".into()); }
                            paths.push(entry.path());
                        }
                    }
                    paths
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
                Err(_) => return Err("Could not read SSH config Include directory".into()),
            }
        } else { vec![path] };
        paths.sort();
        let mut texts = Vec::new();
        for path in paths {
            count += 1;
            if count > 32 { return Err("SSH config includes exceed the 32-file SFTP limit".into()); }
            if let Some(text) = read_bounded(&path)? { texts.push(text); }
        }
        Ok(texts)
    };
    resolve_with_sources(target, &[(&user_config, &user_base), (&system_config, &system_base)], &home, &local_user, &mut include)
}

#[cfg(test)]
fn resolve_with_config(
    target: SftpTarget, text: &str, home: &Path, local_user: &str,
    includes: &mut impl FnMut(&str) -> Result<Vec<String>, String>,
) -> Result<ResolvedTarget, String> {
    resolve_with_sources(target, &[(text, &home.join(".ssh"))], home, local_user, &mut |path, _| includes(path))
}

fn resolve_with_sources(
    target: SftpTarget, sources: &[(&str, &Path)], home: &Path, local_user: &str,
    includes: &mut impl FnMut(&str, &Path) -> Result<Vec<String>, String>,
) -> Result<ResolvedTarget, String> {
    if target.jump_host.as_deref().is_some_and(|value| !value.trim().is_empty() && value != "none") {
        return Err("SFTP jump hosts are not supported yet. Connect through an explicit local SSH tunnel; Husk did not connect directly".into());
    }
    let (embedded_user, host) = target.host.rsplit_once('@').map(|(user, host)| (Some(user), host)).unwrap_or((None, target.host.as_str()));
    let host = host.strip_prefix('[').and_then(|s| s.strip_suffix(']')).unwrap_or(host);
    if !valid_host(host) || embedded_user.is_some_and(|u| !valid_user(u)) { return Err("Invalid SFTP host. Use a hostname, IP address, or SSH config alias, with the port in its separate field".into()); }
    let mut values = ConfigValues::default();
    let mut file_count = 0;
    for (text, include_base) in sources {
        // A trailing, nonmatching Host block in ~/.ssh/config must not hide
        // global policy or routes declared by the system config.
        parse_config(text, host, &mut true, &mut values, include_base, includes, 0, &mut file_count)?;
    }
    for key in ["proxyjump", "proxycommand", "certificatefile", "pkcs11provider", "securitykeyprovider",
        "bindaddress", "bindinterface", "controlpath", "hostkeyalias"] {
        if values.scalar.get(key).is_some_and(|value| !value.eq_ignore_ascii_case("none")) {
            return Err(format!("SFTP does not support SSH config {key}. No direct connection was attempted"));
        }
    }
    for key in ["hostkeyalgorithms", "casignaturealgorithms", "kexalgorithms", "ciphers", "macs", "requiredrsasize", "rekeylimit"] {
        if values.scalar.contains_key(key) {
            return Err(format!("SFTP cannot enforce SSH config {key}. No connection was attempted"));
        }
    }
    for key in ["proxyusefdpass", "controlmaster", "gssapiauthentication", "hostbasedauthentication", "kbdinteractiveauthentication", "challengeresponseauthentication"] {
        if values.scalar.get(key).is_some_and(|value| !matches!(value.to_ascii_lowercase().as_str(), "no" | "false")) {
            return Err(format!("SFTP does not support SSH config {key}. No connection was attempted"));
        }
    }
    if let Some(value) = values.scalar.get("identitiesonly") {
        match value.to_ascii_lowercase().as_str() {
            "yes" | "true" if !matches!(target.auth_type, Some(AuthType::Key | AuthType::Password)) => {
                return Err("SSH config IdentitiesOnly is enabled. SFTP cannot filter agent keys yet; select explicit private-key or password authentication. No credentials were offered".into());
            },
            "yes" | "true" | "no" | "false" => {},
            _ => return Err("Invalid SSH config IdentitiesOnly value".into()),
        }
    }
    // An explicit profile method never bypasses a restriction in SSH config.
    // Automatic SFTP authentication uses public keys; it does not silently
    // change to passwords, keyboard-interactive, GSSAPI or host-based auth.
    let method = if target.auth_type == Some(AuthType::Password) { "password" } else { "publickey" };
    let enabled_key = if method == "password" { "passwordauthentication" } else { "pubkeyauthentication" };
    if values.scalar.get(enabled_key).is_some_and(|value| !matches!(value.to_ascii_lowercase().as_str(), "yes" | "true")) {
        return Err(format!("SSH config {enabled_key} does not permit this SFTP authentication method"));
    }
    if let Some(preferred) = values.scalar.get("preferredauthentications") {
        if !preferred.split(',').any(|allowed| allowed.eq_ignore_ascii_case(method)) {
            return Err(format!("SSH config PreferredAuthentications does not permit {method} authentication"));
        }
    }
    if values.scalar.get("canonicalizehostname").is_some_and(|v| v != "no" && v != "false") {
        return Err("SFTP does not support SSH CanonicalizeHostname rules; use an explicit HostName".into());
    }
    let hostname = values.scalar.get("hostname").map(|s| s.replace("%h", host).replace("%n", host)).unwrap_or_else(|| host.to_string());
    let hostname = hostname.trim_end_matches('.').to_ascii_lowercase();
    if !valid_host(&hostname) { return Err("Invalid HostName in SSH config".into()); }
    let username = target.user.filter(|s| !s.is_empty()).or_else(|| embedded_user.map(str::to_string)).or_else(|| values.scalar.get("user").cloned()).unwrap_or_else(|| local_user.to_string());
    if !valid_user(&username) { return Err("Invalid SFTP username".into()); }
    let port = match target.port {
        Some(port) => port,
        None => values.scalar.get("port").map(|s| s.parse::<u16>().map_err(|_| "Invalid SSH config port")).transpose()?.unwrap_or(22),
    };
    if port == 0 { return Err("SFTP port must be between 1 and 65535".into()); }
    let files = if let Some(file) = target.identity_file.filter(|s| !s.is_empty()) { vec![file] }
        else if values.identities.is_empty() { vec!["~/.ssh/id_ed25519".into(), "~/.ssh/id_rsa".into()] }
        else { values.identities };
    let mut identity_files = Vec::new();
    for file in files {
        if file == "none" { continue; }
        if file.len() > 4096 || file.chars().any(char::is_control) { return Err("Invalid private key path".into()); }
        let expanded = file.replace("%d", &home.to_string_lossy()).replace("%h", &hostname).replace("%r", &username).replace("%u", local_user).replace("%p", &port.to_string());
        let path = expand_home(&expanded, home)?;
        let path = if path.is_absolute() { path } else { home.join(path) };
        identity_files.push(path.to_string_lossy().into_owned());
    }
    let agent_socket = values.scalar.get("identityagent").map(|value| {
        if value == "none" || value == "SSH_AUTH_SOCK" { Ok(value.to_string()) }
        else { expand_home(value, home).map(|p| p.to_string_lossy().into_owned()) }
    }).transpose()?;
    Ok(ResolvedTarget { hostname, port, username, identity_files, auth_type: target.auth_type, agent_socket })
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct VerifiedHosts { pub version: u8, pub hosts: HashMap<String, String> }

pub fn parse_verified_hosts(text: &str) -> Result<HashMap<String, String>, String> {
    let parsed: VerifiedHosts = serde_json::from_str(text).map_err(|_| "The verified SFTP host-key store is invalid; repair it before connecting")?;
    if parsed.version != 1 { return Err("Unsupported verified SFTP host-key store version".into()); }
    Ok(parsed.hosts)
}

pub fn verified_key(stored: Option<&str>, confirmation: Option<&str>, observed: &str) -> Result<bool, String> {
    if let Some(stored) = stored {
        if stored != observed { return Err("SFTP server host key changed. Connection refused. Verify the change with your administrator; confirmation cannot override a changed key".into()); }
        if confirmation.is_some_and(|value| value != observed) { return Err("The confirmed fingerprint does not match this server".into()); }
        return Ok(true);
    }
    if let Some(expected) = confirmation {
        if expected != observed { return Err("SFTP server identity changed while awaiting confirmation. Connection refused; verify the server fingerprint again".into()); }
        return Ok(true);
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn target(host: &str) -> SftpTarget { SftpTarget { host: host.into(), user: None, port: None, identity_file: None, auth_type: None, jump_host: None } }
    fn resolve(target: SftpTarget, config: &str) -> Result<ResolvedTarget, String> {
        resolve_with_config(target, config, Path::new("/fixtures/home"), "local", &mut |_| Err("No fixture include".into()))
    }
    #[test] fn resolves_dns_and_config_alias_without_network() {
        let result = resolve(target("production"), "Host production\n HostName Prod.Example.com\n User deploy\n Port 2222\n IdentityFile ~/.ssh/prod").unwrap();
        assert_eq!(result.hostname, "prod.example.com"); assert_eq!(result.username, "deploy"); assert_eq!(result.port, 2222);
        assert_eq!(result.identity_files, ["/fixtures/home/.ssh/prod"]);
        assert_eq!(result.endpoint(), "[prod.example.com]:2222");
    }
    #[test] fn profile_overrides_config_and_preserves_auth() {
        let mut t = target("alice@alias"); t.user = Some("bob".into()); t.port = Some(2200); t.identity_file = Some("/fixtures/special".into()); t.auth_type = Some(AuthType::Key);
        let result = resolve(t, "Host alias\n User ignored\n Port 999\n IdentityFile ignored").unwrap();
        assert_eq!(result.username, "bob"); assert_eq!(result.port, 2200); assert_eq!(result.identity_files, ["/fixtures/special"]); assert_eq!(result.auth_type, Some(AuthType::Key));
    }
    #[test] fn supports_bracketed_ipv6_and_user_targets() {
        let result = resolve(target("alice@[::1]"), "").unwrap(); assert_eq!(result.hostname, "::1"); assert_eq!(result.username, "alice"); assert_eq!(result.endpoint(), "[::1]:22");
    }
    #[test] fn rejects_ambiguous_or_option_like_targets() {
        for value in ["", "-oProxyCommand=bad", "a b", "host:2222", "user@@host", "ssh://host", "host\n"] { assert!(resolve(target(value), "").is_err(), "{value}"); }
        let mut t = target("host"); t.port = Some(0); assert!(resolve(t, "").is_err());
    }
    #[test] fn rejects_jump_proxy_and_execution_rules_before_connection() {
        for config in ["ProxyJump bastion", "ProxyCommand nc host 22", "Match exec \"touch /never\"\n HostName host", "CanonicalizeHostname yes", "CertificateFile /fixtures/cert"] { assert!(resolve(target("host"), config).is_err(), "{config}"); }
        let mut t = target("host"); t.jump_host = Some("bastion".into()); assert!(resolve(t, "").is_err());
    }
    #[test] fn unrelated_proxy_host_does_not_affect_direct_target() {
        assert!(resolve(target("direct"), "Host private\n ProxyJump bastion\n Host direct\n HostName 127.0.0.1").is_ok());
    }
    #[test] fn honors_first_match_and_negated_patterns() {
        let result = resolve(target("prod-api"), "Host prod-* !prod-db\n User api\nHost *\n User fallback\n Port 2222").unwrap(); assert_eq!(result.username, "api");
        let result = resolve(target("prod-db"), "Host prod-* !prod-db\n User api\nHost *\n User fallback").unwrap(); assert_eq!(result.username, "fallback");
    }
    #[test] fn safely_parses_quotes_comments_and_equals() {
        let result = resolve(target("alias"), "Host alias\n HostName=example.com\n User deploy # comment\n IdentityFile \"~/.ssh/a key\"").unwrap(); assert_eq!(result.identity_files, ["/fixtures/home/.ssh/a key"]);
        let result = resolve(target("alias"), "HostName = example.com\nUser = deploy").unwrap(); assert_eq!(result.hostname, "example.com"); assert_eq!(result.username, "deploy");
        assert!(resolve(target("host"), "IdentityFile \"unterminated").is_err());
        for config in ["Host", "Include", "HostName", "HostName host extra", "ProxyJump", "IdentityFile a b"] {
            assert!(resolve(target("host"), config).is_err(), "{config}");
        }
    }
    #[test] fn bounded_includes_are_parsed_without_commands() {
        let result = resolve_with_config(target("alias"), "Include conf.d/*", Path::new("/fixtures"), "local", &mut |_| Ok(vec!["Host alias\n HostName 127.0.0.1\n Port 2222".into()])).unwrap(); assert_eq!(result.port, 2222);
        assert!(resolve_with_config(target("alias"), "Include recursive", Path::new("/fixtures"), "local", &mut |_| Ok(vec!["Include recursive".into()])).is_err());
    }
    #[test] fn system_sources_reset_host_matching_and_cannot_hide_routes() {
        let sources = [("Host unrelated\n User ignored", Path::new("/fixture/user/.ssh")),
            ("ProxyJump bastion", Path::new("/fixture/system/ssh"))];
        let error = resolve_with_sources(target("prod"), &sources, Path::new("/fixture/user"), "local", &mut |_, _| unreachable!()).unwrap_err();
        assert!(error.contains("proxyjump"));
        let sources = [("Host unrelated", Path::new("/fixture/user/.ssh")),
            ("Include config.d/*", Path::new("/fixture/system/ssh"))];
        let error = resolve_with_sources(target("prod"), &sources, Path::new("/fixture/user"), "local", &mut |_, base| {
            assert_eq!(base, Path::new("/fixture/system/ssh"));
            Ok(vec!["Host prod\n ProxyCommand route-helper %h %p".into()])
        }).unwrap_err();
        assert!(error.contains("proxycommand"));
    }
    #[test] fn config_sources_keep_first_values_and_distinct_include_bases() {
        let sources = [("Include shared\nHost unrelated", Path::new("/fixture/user/.ssh")),
            ("Include shared", Path::new("/fixture/system/ssh"))];
        let mut observed = Vec::new();
        let result = resolve_with_sources(target("prod"), &sources, Path::new("/fixture/user"), "local", &mut |name, base| {
            assert_eq!(name, "shared"); observed.push(base.to_path_buf());
            if base == Path::new("/fixture/user/.ssh") { Ok(vec!["Host prod\nUser chosen\nIdentityFile ~/.ssh/user-key".into()]) }
            else { Ok(vec!["Host prod\nUser system-user\nPort 2222\nIdentityFile /fixture/system/key".into()]) }
        }).unwrap();
        assert_eq!(result.username, "chosen"); assert_eq!(result.port, 2222);
        assert_eq!(result.identity_files, ["/fixture/user/.ssh/user-key", "/fixture/system/key"]);
        assert_eq!(observed, [PathBuf::from("/fixture/user/.ssh"), PathBuf::from("/fixture/system/ssh")]);
    }
    #[test] fn include_file_limit_is_shared_across_user_and_system_config() {
        let sources = [("Include many", Path::new("/fixture/user/.ssh")),
            ("Include many", Path::new("/fixture/system/ssh"))];
        let error = resolve_with_sources(target("prod"), &sources, Path::new("/fixture/user"), "local", &mut |_, _| Ok(vec!["User local".into(); 16])).unwrap_err();
        assert!(error.contains("32-file"));
        let accepted = resolve_with_sources(target("prod"), &sources, Path::new("/fixture/user"), "local", &mut |_, _| Ok(vec!["User local".into(); 15]));
        assert!(accepted.is_ok());
    }
    #[test] fn identities_only_does_not_silently_offer_unfiltered_agent_keys() {
        assert!(resolve(target("host"), "IdentitiesOnly yes").unwrap_err().contains("filter agent keys"));
        let mut explicit = target("host"); explicit.auth_type = Some(AuthType::Agent);
        assert!(resolve(explicit.clone(), "IdentitiesOnly yes").is_err());
        explicit.auth_type = Some(AuthType::Key); explicit.identity_file = Some("/fixture/key".into());
        assert!(resolve(explicit.clone(), "IdentitiesOnly yes").is_ok());
        explicit.auth_type = Some(AuthType::Password);
        assert!(resolve(explicit, "IdentitiesOnly yes").is_ok());
        assert!(resolve(target("host"), "IdentitiesOnly no").is_ok());
        assert!(resolve(target("host"), "IdentitiesOnly nonsense").is_err());
    }
    #[test] fn auth_and_transport_restrictions_fail_closed() {
        for config in ["PubkeyAuthentication no", "PreferredAuthentications password", "GSSAPIAuthentication yes",
            "KbdInteractiveAuthentication yes", "HostbasedAuthentication yes", "BindInterface utun0", "ControlPath ~/.ssh/socket",
            "SecurityKeyProvider /fixture/provider", "HostKeyAlias trusted-alias", "Ciphers aes256-gcm@openssh.com"] {
            assert!(resolve(target("host"), config).is_err(), "{config}");
        }
        let mut password = target("host"); password.auth_type = Some(AuthType::Password);
        assert!(resolve(password.clone(), "PasswordAuthentication no").is_err());
        assert!(resolve(password.clone(), "PubkeyAuthentication no\nPreferredAuthentications password").is_ok());
        assert!(resolve(password, "PreferredAuthentications publickey").is_err());
        assert!(resolve(target("host"), "PreferredAuthentications publickey,password\nPubkeyAuthentication yes\nKbdInteractiveAuthentication no").is_ok());
    }
    #[test] fn include_filename_matching_is_case_sensitive_unlike_host_patterns() {
        assert!(pattern_matches("PROD-*", "prod-api"));
        assert!(filename_pattern_matches("config-*.conf", "config-prod.conf"));
        assert!(!filename_pattern_matches("config-*.conf", "Config-prod.conf"));
    }
    #[test] fn unresolved_home_path_tokens_and_excessive_identities_are_rejected() {
        for value in ["~/$CONFIG", "~/%unknown", "$CONFIG/file", "%d/file"] {
            assert!(expand_home(value, Path::new("/fixture/user")).is_err(), "{value}");
        }
        assert!(resolve(target("host"), "IdentityFile ~/.ssh/%x-unknown").is_err());
        let config = (0..17).map(|index| format!("IdentityFile /fixture/key-{index}\n")).collect::<String>();
        assert!(resolve(target("host"), &config).unwrap_err().contains("16-identity"));
        let repeated = "IdentityFile /fixture/key\n".repeat(17);
        assert_eq!(resolve(target("host"), &repeated).unwrap().identity_files.len(), 1);
    }
    #[test] fn explicit_unknown_confirmation_required_and_changed_key_cannot_bypass() {
        assert_eq!(verified_key(None, None, "SHA256:a"), Ok(false));
        assert_eq!(verified_key(None, Some("SHA256:a"), "SHA256:a"), Ok(true));
        assert!(verified_key(None, Some("SHA256:a"), "SHA256:b").is_err());
        assert!(verified_key(Some("SHA256:a"), Some("SHA256:b"), "SHA256:b").is_err());
        assert_eq!(verified_key(Some("SHA256:a"), None, "SHA256:a"), Ok(true));
    }
    #[test] fn legacy_tofu_map_is_not_verified_trust() {
        assert!(parse_verified_hosts(r#"{"host":"SHA256:legacy"}"#).is_err());
        let hosts = parse_verified_hosts(r#"{"version":1,"hosts":{"[host]:22":"SHA256:verified"}}"#).unwrap(); assert_eq!(hosts["[host]:22"], "SHA256:verified");
    }
    #[test] fn validates_opaque_session_ids() {
        assert!(validate_session_key("sftp:session-1").is_ok()); assert!(validate_session_key("").is_err()); assert!(validate_session_key("x\ny").is_err());
    }
}
