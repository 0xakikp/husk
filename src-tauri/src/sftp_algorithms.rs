//! Resolve a small, explicit subset of OpenSSH algorithm-list policy against
//! this build's russh capabilities. Never fall back after an unsupported name.
use std::borrow::Cow;
use std::collections::{BTreeMap, HashMap};

use russh::{cipher, client, kex, keys::Algorithm, mac, Preferred};

const MAX_POLICY_BYTES: usize = 8_192;
const MAX_POLICY_NAMES: usize = 128;

/// Both source policy and resolved preference order participate in target
/// identity. Confirmation cannot authorize a subsequent policy/config change.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AlgorithmPolicy {
    configured: BTreeMap<String, String>,
    kex: Vec<kex::Name>,
    cipher: Vec<cipher::Name>,
    mac: Vec<mac::Name>,
    key: Vec<Algorithm>,
}

impl Default for AlgorithmPolicy {
    fn default() -> Self {
        let defaults = Preferred::default();
        Self {
            configured: BTreeMap::new(),
            kex: defaults.kex.into_owned(),
            cipher: defaults.cipher.into_owned(),
            mac: defaults.mac.into_owned(),
            key: defaults.key.into_owned(),
        }
    }
}

fn is_kex_extension(name: kex::Name) -> bool {
    [
        kex::EXTENSION_SUPPORT_AS_CLIENT,
        kex::EXTENSION_SUPPORT_AS_SERVER,
        kex::EXTENSION_OPENSSH_STRICT_KEX_AS_CLIENT,
        kex::EXTENSION_OPENSSH_STRICT_KEX_AS_SERVER,
    ]
    .contains(&name)
}

impl AlgorithmPolicy {
    pub(super) fn resolve(values: &HashMap<String, String>) -> Result<Self, String> {
        let mut policy = Self::default();
        for (key, label) in [
            ("kexalgorithms", "KexAlgorithms"),
            ("ciphers", "Ciphers"),
            ("macs", "MACs"),
            ("hostkeyalgorithms", "HostKeyAlgorithms"),
        ] {
            let Some(value) = values.get(key) else {
                continue;
            };
            match key {
                "kexalgorithms" => {
                    // Extension names advertise protocol features, not key
                    // exchange algorithms. Keep strict KEX/EXT_INFO enabled
                    // when replacing the actual algorithm allowlist.
                    let extensions: Vec<_> = policy
                        .kex
                        .iter()
                        .copied()
                        .filter(|n| is_kex_extension(*n))
                        .collect();
                    let defaults: Vec<_> = policy
                        .kex
                        .iter()
                        .copied()
                        .filter(|n| !is_kex_extension(*n))
                        .collect();
                    let supported: Vec<_> = kex::ALL_KEX_ALGORITHMS
                        .iter()
                        .map(|n| **n)
                        .filter(|n| *n != kex::NONE)
                        .collect();
                    policy.kex = resolve_list(label, value, &defaults, &supported)?;
                    policy.kex.extend(extensions);
                }
                "ciphers" => {
                    let supported: Vec<_> = cipher::ALL_CIPHERS
                        .iter()
                        .map(|n| **n)
                        .filter(|n| *n != cipher::NONE && *n != cipher::CLEAR)
                        .collect();
                    policy.cipher = resolve_list(label, value, &policy.cipher, &supported)?;
                }
                "macs" => {
                    let supported: Vec<_> = mac::ALL_MAC_ALGORITHMS
                        .iter()
                        .map(|n| **n)
                        .filter(|n| *n != mac::NONE)
                        .collect();
                    policy.mac = resolve_list(label, value, &policy.mac, &supported)?;
                }
                "hostkeyalgorithms" => {
                    // Algorithm::new accepts arbitrary custom names. Restrict
                    // policy to the concrete host-key implementations exposed
                    // by this backend, not names it can merely deserialize.
                    policy.key = resolve_list(label, value, &policy.key, &Preferred::DEFAULT.key)?;
                }
                _ => unreachable!(),
            }
            policy.configured.insert(label.into(), value.clone());
        }
        Ok(policy)
    }

    pub(super) fn apply(&self, config: &mut client::Config) {
        config.preferred.kex = Cow::Owned(self.kex.clone());
        config.preferred.cipher = Cow::Owned(self.cipher.clone());
        config.preferred.mac = Cow::Owned(self.mac.clone());
        config.preferred.key = Cow::Owned(self.key.clone());
    }
}

/// The backend's defaults are the base for +/^/-, not OpenSSH's different
/// compiled defaults. Exact requested algorithms must all be supported;
/// subtraction may name unavailable algorithms because it cannot enable any.
fn resolve_list<T: AsRef<str> + Clone + Eq>(
    label: &str,
    value: &str,
    defaults: &[T],
    supported: &[T],
) -> Result<Vec<T>, String> {
    let invalid = || {
        format!("Invalid SSH config {label} algorithm list. Use comma-separated names with an optional leading +, ^, or -; only removals support * and ?. No connection was attempted")
    };
    if value.is_empty() || value.len() > MAX_POLICY_BYTES {
        return Err(invalid());
    }
    let (mode, list) = match value.as_bytes()[0] {
        b'+' | b'^' | b'-' => (value.as_bytes()[0], &value[1..]),
        _ => (b'=', value),
    };
    let names: Vec<_> = list.split(',').collect();
    if names.len() > MAX_POLICY_NAMES
        || names.iter().any(|name| {
            name.is_empty()
                || name.len() > 128
                || name.starts_with(['+', '-', '^'])
                || !name.bytes().all(|c| {
                    c.is_ascii_alphanumeric()
                        || b"-_.@".contains(&c)
                        || (mode == b'-' && b"*?".contains(&c))
                })
        })
    {
        return Err(invalid());
    }

    let mut result = Vec::new();
    if mode == b'-' {
        result.extend(
            defaults
                .iter()
                .filter(|name| {
                    !names
                        .iter()
                        .any(|pattern| matches_pattern(pattern, name.as_ref()))
                })
                .cloned(),
        );
    } else {
        let mut requested = Vec::new();
        for name in names {
            let algorithm = supported.iter().find(|algorithm| algorithm.as_ref() == name)
                .ok_or_else(|| format!("SFTP cannot enforce SSH config {label}: algorithm '{name}' is unsupported by this backend. No connection was attempted"))?;
            if !requested.contains(algorithm) {
                requested.push(algorithm.clone());
            }
        }
        let candidates = match mode {
            b'+' => defaults.iter().chain(requested.iter()).collect::<Vec<_>>(),
            b'^' => requested.iter().chain(defaults.iter()).collect::<Vec<_>>(),
            _ => requested.iter().collect::<Vec<_>>(),
        };
        for algorithm in candidates {
            if !result.contains(algorithm) {
                result.push(algorithm.clone());
            }
        }
    }
    if result.is_empty() {
        return Err(format!("SSH config {label} leaves no supported algorithms enabled. No connection was attempted"));
    }
    Ok(result)
}

/// Case-sensitive OpenSSH * and ? matching, without shell execution, regex
/// expansion, character classes or negated subpatterns.
fn matches_pattern(pattern: &str, value: &str) -> bool {
    let (p, v) = (pattern.as_bytes(), value.as_bytes());
    let (mut pi, mut vi, mut star, mut retry) = (0, 0, None, 0);
    while vi < v.len() {
        if pi < p.len() && (p[pi] == b'?' || p[pi] == v[vi]) {
            pi += 1;
            vi += 1;
        } else if pi < p.len() && p[pi] == b'*' {
            star = Some(pi);
            pi += 1;
            retry = vi;
        } else if let Some(index) = star {
            retry += 1;
            vi = retry;
            pi = index + 1;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == b'*' {
        pi += 1;
    }
    pi == p.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(key: &str, value: &str) -> Result<AlgorithmPolicy, String> {
        AlgorithmPolicy::resolve(&HashMap::from([(key.into(), value.into())]))
    }
    fn names<T: AsRef<str>>(list: &[T]) -> Vec<&str> {
        list.iter().map(AsRef::as_ref).collect()
    }

    #[test]
    fn absent_policy_keeps_backend_defaults_exactly() {
        let mut config = client::Config::default();
        let defaults = Preferred::default();
        AlgorithmPolicy::resolve(&HashMap::new())
            .unwrap()
            .apply(&mut config);
        assert_eq!(config.preferred.kex, defaults.kex);
        assert_eq!(config.preferred.key, defaults.key);
        assert_eq!(config.preferred.cipher, defaults.cipher);
        assert_eq!(config.preferred.mac, defaults.mac);
    }

    #[test]
    fn replacement_keeps_only_requested_kex_and_protocol_extensions() {
        let policy = resolve(
            "kexalgorithms",
            "curve25519-sha256,diffie-hellman-group14-sha256,curve25519-sha256",
        )
        .unwrap();
        assert_eq!(
            names(&policy.kex[..2]),
            ["curve25519-sha256", "diffie-hellman-group14-sha256"]
        );
        assert!(policy.kex[2..].iter().all(|n| is_kex_extension(*n)));
        assert!(policy
            .kex
            .contains(&kex::EXTENSION_OPENSSH_STRICT_KEX_AS_CLIENT));
        assert!(policy.kex.contains(&kex::EXTENSION_SUPPORT_AS_CLIENT));
        assert!(!policy.kex.contains(&kex::DH_G1_SHA1));
    }

    #[test]
    fn explicit_append_and_prepend_preserve_order_and_deduplicate() {
        let defaults: Vec<_> = Preferred::DEFAULT
            .kex
            .iter()
            .copied()
            .filter(|n| !is_kex_extension(*n))
            .collect();
        let appended = resolve(
            "kexalgorithms",
            "+diffie-hellman-group14-sha1,curve25519-sha256",
        )
        .unwrap();
        assert_eq!(&appended.kex[..defaults.len()], &defaults);
        assert_eq!(appended.kex[defaults.len()], kex::DH_G14_SHA1);
        let prepended = resolve(
            "kexalgorithms",
            "^curve25519-sha256,diffie-hellman-group14-sha1",
        )
        .unwrap();
        assert_eq!(&prepended.kex[..2], &[kex::CURVE25519, kex::DH_G14_SHA1]);
        assert_eq!(
            prepended
                .kex
                .iter()
                .filter(|n| **n == kex::CURVE25519)
                .count(),
            1
        );
    }

    #[test]
    fn removal_only_filters_backend_defaults_and_honors_case_sensitive_wildcards() {
        let removed = resolve(
            "kexalgorithms",
            "-diffie-hellman-*,curve25519-sha25?,unavailable-algorithm",
        )
        .unwrap();
        assert!(removed
            .kex
            .iter()
            .all(|n| !n.as_ref().starts_with("diffie-hellman-")));
        assert!(!removed.kex.contains(&kex::CURVE25519));
        assert!(removed.kex.contains(&kex::CURVE25519_PRE_RFC_8731));
        assert!(!removed.kex.contains(&kex::ECDH_SHA2_NISTP256));
        let case = resolve("kexalgorithms", "-CURVE*").unwrap();
        assert_eq!(case.kex, Preferred::DEFAULT.kex.as_ref());
    }

    #[test]
    fn unsupported_or_non_algorithm_enablement_never_falls_back() {
        for value in [
            "not-a-kex",
            "curve25519-sha256,not-a-kex",
            "+not-a-kex",
            "^not-a-kex",
            "none",
            "ext-info-c",
            "kex-strict-c-v00@openssh.com",
        ] {
            assert!(
                resolve("kexalgorithms", value)
                    .unwrap_err()
                    .contains("unsupported"),
                "{value}"
            );
        }
        for (key, value) in [
            ("ciphers", "none"),
            ("ciphers", "clear"),
            ("macs", "none"),
            ("hostkeyalgorithms", "ssh-ed25519-cert-v01@openssh.com"),
        ] {
            assert!(
                resolve(key, value).unwrap_err().contains("unsupported"),
                "{key} {value}"
            );
        }
    }

    #[test]
    fn invalid_lists_and_empty_results_fail_closed() {
        for value in [
            "",
            "+",
            "^",
            "-",
            "++curve25519-sha256",
            "--curve25519-sha256",
            "curve25519-sha256,",
            ",curve25519-sha256",
            "curve25519-sha256,,curve25519-sha256",
            "curve25519-sha256, other",
            "curve25519-sha256\n",
            "-!curve*",
            "-[abc]",
            "curve*",
            "+curve*",
            "^curve*",
            "-é",
        ] {
            assert!(resolve("kexalgorithms", value).is_err(), "{value:?}");
        }
        for key in ["kexalgorithms", "ciphers", "macs", "hostkeyalgorithms"] {
            assert!(
                resolve(key, "-*").unwrap_err().contains("no supported"),
                "{key}"
            );
        }
        assert!(resolve("kexalgorithms", &"curve25519-sha256,".repeat(129)).is_err());
        assert!(resolve("kexalgorithms", &"x".repeat(MAX_POLICY_BYTES + 1)).is_err());
    }

    #[test]
    fn cipher_mac_and_host_key_policies_reach_the_actual_client_config() {
        let policy = AlgorithmPolicy::resolve(&HashMap::from([
            ("kexalgorithms".into(), "curve25519-sha256".into()),
            ("ciphers".into(), "aes256-gcm@openssh.com,aes128-ctr".into()),
            ("macs".into(), "hmac-sha2-256-etm@openssh.com".into()),
            (
                "hostkeyalgorithms".into(),
                "rsa-sha2-512,ssh-ed25519".into(),
            ),
        ]))
        .unwrap();
        let mut config = client::Config::default();
        policy.apply(&mut config);
        assert_eq!(
            names(&config.preferred.cipher),
            ["aes256-gcm@openssh.com", "aes128-ctr"]
        );
        assert_eq!(
            names(&config.preferred.mac),
            ["hmac-sha2-256-etm@openssh.com"]
        );
        assert_eq!(
            names(&config.preferred.key),
            ["rsa-sha2-512", "ssh-ed25519"]
        );
        assert_eq!(config.preferred.kex, policy.kex);
        assert_eq!(config.preferred.compression, Preferred::DEFAULT.compression);
    }

    #[test]
    fn policy_identity_changes_even_when_source_edit_has_no_effect_on_defaults() {
        let absent = AlgorithmPolicy::default();
        let explicit = resolve("kexalgorithms", "+curve25519-sha256").unwrap();
        assert_eq!(absent.kex, explicit.kex);
        assert_ne!(absent, explicit);
    }
}
