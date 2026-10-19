//! Read-only context labels for a local terminal's reported configuration.
//!
//! This module does not consult Husk's environment, execute a CLI or credential
//! helper, follow certificate/key references, or contact a service. Parsing a
//! configured label is not evidence that a tool is installed or connected.

use std::collections::{HashMap, HashSet};
use std::fs::OpenOptions;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::de::{Error, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};

const MAX_PATH_BYTES: usize = 4096;
const MAX_CONFIG_PATHS: usize = 16;
const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 4 * 1024 * 1024;
const MAX_LABEL_BYTES: usize = 512;
const MAX_CONTEXTS: usize = 4096;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextRequest {
    cwd: String,
    kubeconfig: Option<String>,
    default_kubeconfig_path: Option<String>,
    docker_config: Option<String>,
    docker_context: Option<String>,
    docker_host: bool,
    kubernetes: bool,
    docker: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KubernetesContext {
    context: String,
    namespace: Option<String>,
    source: &'static str,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockerContext {
    context: String,
    source: &'static str,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedContexts {
    kubernetes: Option<KubernetesContext>,
    docker: Option<DockerContext>,
    kubernetes_reason: Option<String>,
    docker_reason: Option<String>,
}

// Deserialize only the fields used for labels. Credential material and exec
// stanzas are ignored rather than retained in a general-purpose YAML/JSON tree.
#[derive(Deserialize, Default)]
struct KubeConfig {
    #[serde(rename = "current-context")]
    current_context: Option<StatusLabel>,
    contexts: Option<ContextList>,
    #[serde(rename = "<<", default, deserialize_with = "merge_present")]
    merge: bool,
}

#[derive(Deserialize)]
struct NamedContext {
    name: StatusLabel,
    context: KubeContext,
    #[serde(rename = "<<", default, deserialize_with = "merge_present")]
    merge: bool,
}

#[derive(Deserialize)]
struct KubeContext {
    namespace: Option<StatusLabel>,
    #[serde(rename = "<<", default, deserialize_with = "merge_present")]
    merge: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DockerConfig {
    current_context: Option<StatusLabel>,
}

fn merge_present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    serde::de::IgnoredAny::deserialize(deserializer).map(|_| true)
}

// Bound allocations while deserializing, not afterwards: a short YAML alias
// can otherwise duplicate a long scalar many times before post-parse checks.
struct StatusLabel(String);

impl<'de> Deserialize<'de> for StatusLabel {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct LabelVisitor;
        impl Visitor<'_> for LabelVisitor {
            type Value = StatusLabel;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a bounded terminal context label")
            }

            fn visit_str<E: Error>(self, value: &str) -> Result<Self::Value, E> {
                if value.len() > MAX_LABEL_BYTES || has_unsafe_characters(value) {
                    return Err(E::custom("unsupported terminal context label"));
                }
                Ok(StatusLabel(value.to_owned()))
            }
        }
        // Preserve YAML scalar types. Coercing a number/bool into a label could
        // display a context that Kubernetes' YAML-to-JSON loader would reject.
        deserializer.deserialize_any(LabelVisitor)
    }
}

struct ContextList(Vec<NamedContext>);

impl<'de> Deserialize<'de> for ContextList {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ContextVisitor;
        impl<'de> Visitor<'de> for ContextVisitor {
            type Value = ContextList;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a bounded list of Kubernetes contexts")
            }

            fn visit_seq<A: SeqAccess<'de>>(
                self,
                mut sequence: A,
            ) -> Result<Self::Value, A::Error> {
                let mut contexts = Vec::new();
                while let Some(context) = sequence.next_element::<NamedContext>()? {
                    if contexts.len() == MAX_CONTEXTS {
                        return Err(A::Error::custom("too many Kubernetes contexts"));
                    }
                    contexts.push(context);
                }
                Ok(ContextList(contexts))
            }
        }
        deserializer.deserialize_seq(ContextVisitor)
    }
}

fn has_unsafe_characters(value: &str) -> bool {
    value.chars().any(|c| {
        c.is_control()
            || matches!(c, '\u{061c}' | '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{feff}')
    })
}

fn valid_label(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= MAX_LABEL_BYTES && !has_unsafe_characters(value)
}

fn valid_path(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_PATH_BYTES && !has_unsafe_characters(value)
}

fn resolve_path(value: &str, cwd: &Path) -> Result<PathBuf, &'static str> {
    if !valid_path(value) {
        return Err("The terminal reported an unsupported configuration path.");
    }
    let path = Path::new(value);
    // A literal '~' is not expanded by kubectl/Docker when it comes from an
    // environment variable either. Do not substitute the application's HOME.
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    if path.as_os_str().len() > MAX_PATH_BYTES {
        return Err("The terminal reported an unsupported configuration path.");
    }
    Ok(path)
}

fn read_config(path: &Path) -> Result<Option<Vec<u8>>, &'static str> {
    let metadata = match std::fs::metadata(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("The selected configuration file could not be read."),
    };
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err("The selected configuration must be a regular file no larger than 1 MiB.");
    }
    let mut options = OpenOptions::new();
    options.read(true);
    // A file could be replaced with a FIFO between metadata and open. Do not
    // block waiting for a writer, and recheck the opened descriptor's type.
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOCTTY);
    }
    let file = options
        .open(path)
        .map_err(|_| "The selected configuration file could not be read.")?;
    let opened = file
        .metadata()
        .map_err(|_| "The selected configuration file could not be read.")?;
    if !opened.is_file() || opened.len() > MAX_FILE_BYTES {
        return Err("The selected configuration must be a regular file no larger than 1 MiB.");
    }
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "The selected configuration file could not be read.")?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("The selected configuration must be a regular file no larger than 1 MiB.");
    }
    Ok(Some(bytes))
}

fn kube_paths(request: &ContextRequest, cwd: &Path) -> Result<Vec<PathBuf>, &'static str> {
    let mut paths = Vec::new();
    if let Some(list) = request
        .kubeconfig
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        if list.len() > MAX_CONFIG_PATHS * (MAX_PATH_BYTES + 1) || has_unsafe_characters(list) {
            return Err("The terminal reported an unsupported KUBECONFIG path list.");
        }
        for path in std::env::split_paths(list).filter(|path| !path.as_os_str().is_empty()) {
            if paths.len() == MAX_CONFIG_PATHS {
                return Err("At most 16 kubeconfig paths can be inspected for terminal status.");
            }
            let text = path
                .to_str()
                .ok_or("The terminal reported an unsupported configuration path.")?;
            paths.push(resolve_path(text, cwd)?);
        }
    } else if let Some(default) = request.default_kubeconfig_path.as_deref() {
        paths.push(resolve_path(default, cwd)?);
    }
    if paths.is_empty() {
        return Err("This terminal has not reported a kubeconfig file.");
    }
    // KUBECONFIG lists can repeat the same file; loading it once preserves the
    // first-file-wins semantics while avoiding unnecessary disk work.
    let mut seen = HashSet::new();
    paths.retain(|path| seen.insert(path.clone()));
    Ok(paths)
}

fn resolve_kubernetes(
    request: &ContextRequest,
    cwd: &Path,
) -> Result<KubernetesContext, &'static str> {
    let paths = kube_paths(request, cwd)?;
    let mut current_context = None;
    let mut contexts: HashMap<String, KubeContext> = HashMap::new();
    let mut total_bytes = 0;
    let mut found_file = false;
    for path in paths {
        // Missing entries are ignored by Kubernetes' KUBECONFIG merge. An
        // unreadable, malformed or oversized existing entry fails closed.
        let Some(bytes) = read_config(&path)? else {
            continue;
        };
        found_file = true;
        total_bytes += bytes.len();
        if total_bytes > MAX_TOTAL_BYTES {
            return Err("The combined kubeconfig files are too large for terminal status.");
        }
        // The parser handles YAML aliases, comments, quoted scalars and JSON;
        // never scrape line patterns or return parser errors containing data.
        let config = serde_yaml_ng::from_slice::<Option<KubeConfig>>(&bytes)
            .map_err(|_| "The selected kubeconfig could not be parsed safely.")?
            .unwrap_or_default();
        // Serde deliberately does not apply YAML's optional merge-key extension.
        // Never silently treat an inherited namespace as absent/default. Ordinary
        // aliases are supported, but merged mappings must remain unresolved.
        if config.merge {
            return Err("YAML merge keys are not supported for terminal context status.");
        }
        if let Some(name) = config
            .current_context
            .map(|label| label.0)
            .filter(|name| !name.is_empty())
        {
            if !valid_label(&name) {
                return Err("The selected kubeconfig contains an unsupported context name.");
            }
            if current_context.is_none() {
                current_context = Some(name);
            }
        }
        let mut local_names = HashSet::new();
        for entry in config.contexts.map(|list| list.0).unwrap_or_default() {
            if entry.merge || entry.context.merge {
                return Err("YAML merge keys are not supported for terminal context status.");
            }
            if !valid_label(&entry.name.0) || !local_names.insert(entry.name.0.clone()) {
                return Err("The selected kubeconfig contains invalid or duplicate contexts.");
            }
            if let Some(namespace) = entry
                .context
                .namespace
                .as_ref()
                .map(|label| label.0.as_str())
                .filter(|value| !value.is_empty())
            {
                if !valid_label(namespace) {
                    return Err("The selected kubeconfig contains an unsupported namespace.");
                }
            }
            // Do not merge namespace fields into a context from an earlier file.
            contexts.entry(entry.name.0).or_insert(entry.context);
            if contexts.len() > MAX_CONTEXTS {
                return Err(
                    "The selected kubeconfig contains too many contexts for terminal status.",
                );
            }
        }
    }
    if !found_file {
        return Err("The terminal's kubeconfig file is not available.");
    }
    let context = current_context
        .ok_or("No Kubernetes context is selected in this terminal's configuration.")?;
    let selected = contexts
        .remove(&context)
        .ok_or("The selected Kubernetes context has no matching configuration entry.")?;
    Ok(KubernetesContext {
        context,
        namespace: Some(
            selected
                .namespace
                .map(|label| label.0)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "default".to_owned()),
        ),
        source: "config",
    })
}

fn resolve_docker(request: &ContextRequest, cwd: &Path) -> Result<DockerContext, &'static str> {
    if let Some(context) = request
        .docker_context
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        if !valid_label(context) {
            return Err("The terminal reported an unsupported Docker context name.");
        }
        return Ok(DockerContext {
            context: context.to_owned(),
            source: "shell",
        });
    }
    if request.docker_host {
        return Err("DOCKER_HOST overrides the configured Docker context in this terminal.");
    }
    let config_dir = request
        .docker_config
        .as_deref()
        .ok_or("This terminal has not reported its Docker configuration directory.")?;
    let path = resolve_path(config_dir, cwd)?.join("config.json");
    let bytes =
        read_config(&path)?.ok_or("The terminal's Docker configuration file is not available.")?;
    let config: DockerConfig = serde_json::from_slice(&bytes)
        .map_err(|_| "The selected Docker configuration could not be parsed safely.")?;
    let context = config
        .current_context
        .map(|label| label.0)
        .filter(|value| !value.is_empty())
        .ok_or("No Docker context is selected in this terminal's configuration.")?;
    if !valid_label(&context) {
        return Err("The selected Docker configuration contains an unsupported context name.");
    }
    Ok(DockerContext {
        context,
        source: "config",
    })
}

fn resolve(request: ContextRequest) -> ResolvedContexts {
    let mut result = ResolvedContexts::default();
    let cwd = Path::new(&request.cwd);
    if !valid_path(&request.cwd) || !cwd.is_absolute() {
        let reason = "The terminal has not reported a valid absolute working directory.";
        if request.kubernetes {
            result.kubernetes_reason = Some(reason.into());
        }
        if request.docker {
            result.docker_reason = Some(reason.into());
        }
        return result;
    }
    if request.kubernetes {
        match resolve_kubernetes(&request, cwd) {
            Ok(context) => result.kubernetes = Some(context),
            Err(reason) => result.kubernetes_reason = Some(reason.into()),
        }
    }
    if request.docker {
        match resolve_docker(&request, cwd) {
            Ok(context) => result.docker = Some(context),
            Err(reason) => result.docker_reason = Some(reason.into()),
        }
    }
    result
}

#[tauri::command]
pub async fn terminal_resolve_contexts(
    request: ContextRequest,
) -> Result<ResolvedContexts, String> {
    tauri::async_runtime::spawn_blocking(move || resolve(request))
        .await
        .map_err(|_| "Terminal configuration inspection could not complete.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "husk-terminal-context-test-{}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn file(&self, name: &str, contents: impl AsRef<[u8]>) -> String {
            let path = self.0.join(name);
            std::fs::write(&path, contents).unwrap();
            path.to_str().unwrap().to_owned()
        }

        fn request(&self) -> ContextRequest {
            ContextRequest {
                cwd: self.0.to_str().unwrap().to_owned(),
                kubeconfig: None,
                default_kubeconfig_path: None,
                docker_config: None,
                docker_context: None,
                docker_host: false,
                kubernetes: true,
                docker: true,
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn path_list(paths: &[&str]) -> String {
        std::env::join_paths(paths).unwrap().into_string().unwrap()
    }

    #[test]
    fn parses_quoted_flow_style_aliases_and_json_without_reading_credentials() {
        let fixture = Fixture::new();
        let marker = fixture.0.join("must-not-exist");
        let config = fixture.file("config", format!(
            "current-context: 'team: prod'\ncontexts:\n- name: &selected 'team: prod'\n  context: {{namespace: 'payments', cluster: cluster1, user: ignored}}\n- name: alternate\n  context: {{namespace: archive}}\nusers:\n- name: ignored\n  user:\n    token: super-secret\n    client-key: /never/read/me\n    exec:\n      command: touch\n      args: ['{}']\nclusters:\n- name: cluster1\n  cluster: {{server: 'https://must-not-contact.invalid', certificate-authority: /never/read/me}}\n",
            marker.display()
        ));
        let mut request = fixture.request();
        request.kubeconfig = Some(config);
        let result = resolve(request);
        let context = result.kubernetes.unwrap();
        assert_eq!(context.context, "team: prod");
        assert_eq!(context.namespace.as_deref(), Some("payments"));
        assert_eq!(context.source, "config");
        assert!(!marker.exists());
        let mut request = fixture.request();
        request.kubeconfig = Some(fixture.file(
            "json",
            r#"{"current-context":"json","contexts":[{"name":"json","context":{}}]}"#,
        ));
        assert_eq!(resolve(request).kubernetes.unwrap().context, "json");
    }

    #[test]
    fn yaml_aliases_are_supported_for_selected_context_and_namespace() {
        let fixture = Fixture::new();
        let mut request = fixture.request();
        request.kubeconfig = Some(fixture.file("config", "current-context: &name staging\ncontexts:\n- name: *name\n  context: &details {namespace: payments}\n- name: other\n  context: *details\n"));
        let selected = resolve(request).kubernetes.unwrap();
        assert_eq!(selected.context, "staging");
        assert_eq!(selected.namespace.as_deref(), Some("payments"));
    }

    #[test]
    fn kube_merge_uses_first_value_and_whole_context_not_later_namespace() {
        let fixture = Fixture::new();
        let first = fixture.file(
            "first",
            "current-context: staging\ncontexts:\n- name: staging\n  context: {}\n",
        );
        let second = fixture.file("second", "current-context: prod\ncontexts:\n- name: staging\n  context: {namespace: not-this}\n- name: prod\n  context: {namespace: not-this-either}\n");
        let mut request = fixture.request();
        request.kubeconfig = Some(path_list(&[&first, &second]));
        let selected = resolve(request).kubernetes.unwrap();
        assert_eq!(selected.context, "staging");
        assert_eq!(selected.namespace.as_deref(), Some("default"));
    }

    #[test]
    fn kube_merge_can_find_context_in_later_file_and_ignore_missing_entries() {
        let fixture = Fixture::new();
        let first = fixture.file("first", "current-context: staging\n");
        let second = fixture.file(
            "second",
            "contexts:\n- name: staging\n  context: {namespace: payments}\n",
        );
        let mut request = fixture.request();
        request.kubeconfig = Some(path_list(&["", "missing", &first, &second, ""]));
        assert_eq!(
            resolve(request).kubernetes.unwrap().namespace.as_deref(),
            Some("payments")
        );
    }

    #[test]
    fn relative_paths_are_resolved_only_from_the_terminal_cwd() {
        let fixture = Fixture::new();
        fixture.file(
            "relative",
            "current-context: local\ncontexts: [{name: local, context: {}}]\n",
        );
        let mut request = fixture.request();
        request.kubeconfig = Some("relative".into());
        assert_eq!(resolve(request).kubernetes.unwrap().context, "local");
        let mut request = fixture.request();
        request.kubeconfig = Some("relative".into());
        request.cwd = "relative-cwd".into();
        let result = resolve(request);
        assert!(result.kubernetes.is_none());
        assert!(result.kubernetes_reason.unwrap().contains("absolute"));
    }

    #[test]
    fn absent_or_empty_exports_only_use_the_reported_default() {
        let fixture = Fixture::new();
        let default = fixture.file(
            "default",
            "current-context: local\ncontexts: [{name: local, context: {}}]\n",
        );
        for exported in [None, Some(String::new())] {
            let mut request = fixture.request();
            request.kubeconfig = exported;
            request.default_kubeconfig_path = Some(default.clone());
            assert_eq!(resolve(request).kubernetes.unwrap().context, "local");
        }
        let mut request = fixture.request();
        request.default_kubeconfig_path = Some(default);
        request.kubeconfig = Some(path_list(&["", ""]));
        assert!(resolve(request).kubernetes.is_none());
        let result = resolve(fixture.request());
        assert!(result.kubernetes.is_none());
        assert!(result.docker.is_none());
    }

    #[test]
    fn missing_or_malformed_selected_context_never_invents_a_default() {
        let fixture = Fixture::new();
        for contents in [
            "",
            "{}",
            "current-context: absent\ncontexts: []",
            "current-context: absent\ncontexts: [{name: absent}]",
            "current-context: absent\ncontexts: [{name: absent, context: null}]",
            "current-context: local\ncontexts: [{name: local, context: {}}, {name: local, context: {}}]",
        ] {
            let mut request = fixture.request();
            request.kubeconfig = Some(fixture.file("config", contents));
            let result = resolve(request);
            assert!(result.kubernetes.is_none(), "unexpected context from {contents}");
            assert!(result.kubernetes_reason.is_some());
        }
    }

    #[test]
    fn malformed_later_file_invalidates_the_entire_kube_merge_and_hides_parser_data() {
        let fixture = Fixture::new();
        let valid = fixture.file(
            "valid",
            "current-context: local\ncontexts: [{name: local, context: {}}]",
        );
        let invalid = fixture.file("invalid", "current-context: [secret-value\n");
        let mut request = fixture.request();
        request.kubeconfig = Some(path_list(&[&valid, &invalid]));
        let result = resolve(request);
        assert!(result.kubernetes.is_none());
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains("secret-value"));
    }

    #[test]
    fn docker_shell_context_beats_host_and_configuration_without_reading_it() {
        let fixture = Fixture::new();
        let mut request = fixture.request();
        request.docker_context = Some("orbstack".into());
        request.docker_host = true;
        request.docker_config = Some("missing".into());
        let selected = resolve(request).docker.unwrap();
        assert_eq!(selected.context, "orbstack");
        assert_eq!(selected.source, "shell");
    }

    #[test]
    fn docker_host_suppresses_saved_context_without_exposing_endpoint() {
        let fixture = Fixture::new();
        fixture.file("config.json", r#"{"currentContext":"orbstack"}"#);
        let mut request = fixture.request();
        request.docker_config = Some(fixture.0.to_str().unwrap().into());
        request.docker_host = true;
        let result = resolve(request);
        assert!(result.docker.is_none());
        assert!(result.docker_reason.unwrap().starts_with("DOCKER_HOST"));
    }

    #[test]
    fn docker_reads_only_selected_context_and_ignores_credentials_and_helpers() {
        let fixture = Fixture::new();
        fixture.file("config.json", r#"{"currentContext":"orbstack","credsStore":"must-not-execute","auths":{"secret-registry":{"auth":"secret-value"}}}"#);
        let mut request = fixture.request();
        request.docker_config = Some(fixture.0.to_str().unwrap().into());
        let result = resolve(request);
        assert_eq!(result.docker.as_ref().unwrap().context, "orbstack");
        assert_eq!(result.docker.as_ref().unwrap().source, "config");
        assert!(!serde_json::to_string(&result).unwrap().contains("secret"));
    }

    #[test]
    fn docker_does_not_invent_default_but_accepts_an_explicit_default() {
        let fixture = Fixture::new();
        for contents in ["{}", r#"{"currentContext":""}"#, "not JSON"] {
            fixture.file("config.json", contents);
            let mut request = fixture.request();
            request.docker_config = Some(fixture.0.to_str().unwrap().into());
            assert!(resolve(request).docker.is_none());
        }
        fixture.file("config.json", r#"{"currentContext":"default"}"#);
        let mut request = fixture.request();
        request.docker_config = Some(fixture.0.to_str().unwrap().into());
        assert_eq!(resolve(request).docker.unwrap().context, "default");
    }

    #[test]
    fn unrequested_integrations_are_not_read_or_reported() {
        let fixture = Fixture::new();
        let mut request = fixture.request();
        request.kubernetes = false;
        request.docker = false;
        request.cwd = "invalid".into();
        request.kubeconfig = Some("/must/not/be/read".into());
        request.docker_context = Some("must-not-appear".into());
        let result = resolve(request);
        assert!(result.kubernetes.is_none());
        assert!(result.docker.is_none());
        assert!(result.kubernetes_reason.is_none());
        assert!(result.docker_reason.is_none());
    }

    #[test]
    fn rejects_control_characters_bidi_and_oversized_labels_or_paths() {
        let fixture = Fixture::new();
        for value in [
            "bad\nlabel".into(),
            "bad\u{202e}label".into(),
            "x".repeat(MAX_LABEL_BYTES + 1),
        ] {
            let mut request = fixture.request();
            request.docker_context = Some(value);
            assert!(resolve(request).docker.is_none());
        }
        for value in ["bad\npath".into(), "x".repeat(MAX_PATH_BYTES + 1)] {
            let mut request = fixture.request();
            request.kubeconfig = Some(value);
            assert!(resolve(request).kubernetes.is_none());
        }
    }

    #[test]
    fn rejects_directories_oversized_files_and_too_many_paths() {
        let fixture = Fixture::new();
        let mut request = fixture.request();
        request.kubeconfig = Some(fixture.0.to_str().unwrap().into());
        assert!(resolve(request).kubernetes.is_none());
        let oversized = fixture.file("large", vec![b' '; MAX_FILE_BYTES as usize + 1]);
        let mut request = fixture.request();
        request.kubeconfig = Some(oversized);
        assert!(resolve(request).kubernetes.is_none());
        let mut request = fixture.request();
        request.kubeconfig = Some(path_list(&vec!["missing"; MAX_CONFIG_PATHS + 1]));
        assert!(resolve(request).kubernetes.is_none());
    }

    #[test]
    fn recursive_yaml_aliases_fail_safely_without_returning_parser_contents() {
        let fixture = Fixture::new();
        let mut request = fixture.request();
        request.kubeconfig = Some(fixture.file(
            "config",
            "current-context: secret-value\ncontexts: &loop [*loop]\n",
        ));
        let result = resolve(request);
        assert!(result.kubernetes.is_none());
        assert!(!serde_json::to_string(&result)
            .unwrap()
            .contains("secret-value"));
    }

    #[test]
    fn yaml_aliases_cannot_amplify_labels_or_context_allocations_without_bounds() {
        let fixture = Fixture::new();
        let mut request = fixture.request();
        request.kubeconfig = Some(fixture.file(
            "config",
            format!(
                "secret: &large '{}'\ncurrent-context: *large\ncontexts: []\n",
                "x".repeat(MAX_LABEL_BYTES + 1)
            ),
        ));
        assert!(resolve(request).kubernetes.is_none());
        let mut request = fixture.request();
        request.kubeconfig = Some(fixture.file("config", format!(
            "selected: &entry {{name: local, context: {{}}}}\ncurrent-context: local\ncontexts: [{}]\n", vec!["*entry"; MAX_CONTEXTS + 1].join(",")
        )));
        let started = std::time::Instant::now();
        assert!(resolve(request).kubernetes.is_none());
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }

    #[test]
    fn unsupported_yaml_merge_keys_fail_closed_instead_of_inventing_namespace() {
        let fixture = Fixture::new();
        for contents in [
            "defaults: &defaults {namespace: actual}\ncurrent-context: local\ncontexts: [{name: local, context: {<<: *defaults}}]",
            "defaults: &defaults {current-context: actual}\n<<: *defaults\ncontexts: [{name: local, context: {}}]",
            "current-context: local\ncontexts: [{name: local, context: {<<: null}}]",
        ] {
            let mut request = fixture.request();
            request.kubeconfig = Some(fixture.file("config", contents));
            let result = resolve(request);
            assert!(result.kubernetes.is_none());
            assert!(result.kubernetes_reason.unwrap().contains("merge keys"));
        }
    }

    #[test]
    fn non_string_yaml_and_json_labels_are_not_coerced_into_contexts() {
        let fixture = Fixture::new();
        for contents in [
            "current-context: 123\ncontexts: [{name: 123, context: {}}]",
            "current-context: local\ncontexts: [{name: local, context: {namespace: true}}]",
            "current-context: !untrusted local\ncontexts: [{name: local, context: {}}]",
        ] {
            let mut request = fixture.request();
            request.kubeconfig = Some(fixture.file("config", contents));
            assert!(resolve(request).kubernetes.is_none());
        }
        fixture.file("config.json", r#"{"currentContext":123}"#);
        let mut request = fixture.request();
        request.docker_config = Some(fixture.0.to_str().unwrap().into());
        assert!(resolve(request).docker.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_fifos_devices_and_symlinks_to_them_without_waiting() {
        use std::ffi::CString;
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let fifo = fixture.0.join("fifo");
        let c_path = CString::new(fifo.to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);
        let link = fixture.0.join("linked-fifo");
        symlink(&fifo, &link).unwrap();
        let started = std::time::Instant::now();
        for path in [fifo.as_path(), link.as_path(), Path::new("/dev/null")] {
            assert!(read_config(path).is_err());
        }
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }

    #[cfg(unix)]
    #[test]
    fn normal_config_symlinks_remain_supported() {
        let fixture = Fixture::new();
        let real = fixture.file(
            "real",
            "current-context: local\ncontexts: [{name: local, context: {}}]",
        );
        std::os::unix::fs::symlink(real, fixture.0.join("link")).unwrap();
        let mut request = fixture.request();
        request.kubeconfig = Some("link".into());
        assert_eq!(resolve(request).kubernetes.unwrap().context, "local");
    }
}
