//! Small, content-free native panic diagnostics. This is not an OS crash or
//! hang detector: SIGKILL, WebKit failures and forced quits do not run Rust's
//! panic hook. Keep only the latest native panic, never terminal/user content.

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static REPORTING_ENABLED: AtomicBool = AtomicBool::new(false);
static REPORT_PATH: OnceLock<PathBuf> = OnceLock::new();
const MAX_REPORT_BYTES: u64 = 4096;
const LIMITATION: &str = "Only the latest Rust panic is recorded. No record does not rule out a crash or hang. OS termination reports from the affected machine are still needed. No terminal output, commands, paths, credentials or panic messages are included.";

#[derive(Debug, Serialize, Deserialize)]
struct NativePanic {
    version: String,
    platform: String,
    arch: String,
    unix_seconds: u64,
    source_file: Option<String>,
    source_line: Option<u32>,
}

fn basename(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .next()
        .unwrap_or("unknown")
        .chars()
        .take(100)
        .collect()
}

impl NativePanic {
    fn new(location: Option<(&str, u32)>) -> Self {
        Self {
            version: env!("CARGO_PKG_VERSION").into(),
            platform: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
            unix_seconds: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            source_file: location.map(|(file, _)| basename(file)),
            source_line: location.map(|(_, line)| line),
        }
    }

    fn event(&self) -> sentry::protocol::Event<'static> {
        let mut event = sentry::protocol::Event {
            message: Some("Native Rust panic (content omitted)".into()),
            level: sentry::Level::Fatal,
            release: Some(format!("husk@{}", env!("CARGO_PKG_VERSION")).into()),
            environment: Some(
                if cfg!(debug_assertions) {
                    "development"
                } else {
                    "production"
                }
                .into(),
            ),
            ..Default::default()
        };
        event.tags.insert("platform".into(), self.platform.clone());
        event.tags.insert("arch".into(), self.arch.clone());
        if let Some(file) = &self.source_file {
            event.tags.insert("source_file".into(), file.clone());
        }
        if let Some(line) = self.source_line {
            event.tags.insert("source_line".into(), line.to_string());
        }
        event
    }
}

struct ConsentTransport(Arc<dyn sentry::Transport>);
impl sentry::Transport for ConsentTransport {
    fn send_envelope(&self, envelope: sentry::Envelope) {
        if REPORTING_ENABLED.load(Ordering::SeqCst) {
            self.0.send_envelope(envelope);
        }
    }
    fn flush(&self, timeout: Duration) -> bool {
        self.0.flush(timeout)
    }
    fn shutdown(&self, timeout: Duration) -> bool {
        self.0.shutdown(timeout)
    }
}

struct ConsentTransportFactory;
impl sentry::TransportFactory for ConsentTransportFactory {
    fn create_transport_with_options(
        &self,
        options: sentry::TransportOptions,
    ) -> Arc<dyn sentry::Transport> {
        Arc::new(ConsentTransport(
            sentry::transports::DefaultTransportFactory.create_transport_with_options(options),
        ))
    }
}

pub(crate) fn init() -> sentry::ClientInitGuard {
    let guard = sentry::init((
        "https://4f0f3f635fe76c93a1f870b365b5aba5@o4511596996067328.ingest.de.sentry.io/4511597298647120",
        sentry::ClientOptions {
            release: Some(format!("husk@{}", env!("CARGO_PKG_VERSION")).into()),
            // Our hook emits only the fixed metadata above. Default native
            // integrations also include panic payloads and device contexts.
            default_integrations: false,
            max_breadcrumbs: 0,
            send_default_pii: false,
            auto_session_tracking: false,
            enable_logs: false,
            enable_metrics: false,
            before_send: Some(Arc::new(|event| REPORTING_ENABLED.load(Ordering::SeqCst).then_some(event))),
            transport: Some(Arc::new(ConsentTransportFactory)),
            shutdown_timeout: Duration::from_millis(200),
            ..Default::default()
        },
    ));
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let report = NativePanic::new(
            info.location()
                .map(|location| (location.file(), location.line())),
        );
        if let Some(path) = REPORT_PATH.get() {
            let _ = save_report(path, &report);
        }
        if REPORTING_ENABLED.load(Ordering::SeqCst) {
            sentry::capture_event(report.event());
            // Bounded even on a broken network; never wait seconds in a panic.
            if let Some(client) = sentry::Hub::current().client() {
                client.flush(Some(Duration::from_millis(200)));
            }
        }
        previous(info);
    }));
    guard
}

pub(crate) fn set_storage_directory(directory: PathBuf) {
    let _ = REPORT_PATH.set(directory.join("last-native-panic.json"));
}

fn save_report(path: &Path, report: &NativePanic) -> Result<(), String> {
    let bytes = serde_json::to_vec(report).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_REPORT_BYTES {
        return Err("Diagnostic record exceeds size limit".into());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    // A single overwritten record, not a growing log. Partial writes after an
    // OS kill are treated as an unreadable record rather than a startup error.
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

fn read_report(path: &Path) -> Result<Option<NativePanic>, String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Previous native panic record could not be read".into()),
    };
    let mut bytes = Vec::new();
    file.take(MAX_REPORT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Previous native panic record could not be read")?;
    if bytes.len() as u64 > MAX_REPORT_BYTES {
        return Err("Previous native panic record exceeds size limit".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "Previous native panic record is incomplete".into())
}

#[tauri::command]
pub fn diagnostics_set_reporting_enabled(enabled: bool) {
    // Fail closed until the webview synchronizes the saved privacy setting.
    // Events already handed to the transport before opt-out cannot be recalled.
    REPORTING_ENABLED.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
pub async fn diagnostics_snapshot() -> Result<String, String> {
    crate::shell::run_blocking_command(|| {
        let (last_panic, record_status) = match REPORT_PATH.get().map(|path| read_report(path)) {
            Some(Ok(report)) => (report, "available".to_string()),
            Some(Err(error)) => (None, error),
            None => (None, "Local diagnostics storage unavailable".into()),
        };
        serde_json::to_string_pretty(&serde_json::json!({
            "version": env!("CARGO_PKG_VERSION"),
            "platform": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "build": if cfg!(debug_assertions) { "development" } else { "release" },
            "native_reporting_enabled": REPORTING_ENABLED.load(Ordering::SeqCst),
            "last_native_panic": last_panic,
            "record_status": record_status,
            "scope": LIMITATION,
        }))
        .map_err(|error| error.to_string())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_transport_fails_closed_and_stops_accepting_events_on_opt_out() {
        struct CountingTransport(std::sync::atomic::AtomicUsize);
        impl sentry::Transport for CountingTransport {
            fn send_envelope(&self, _: sentry::Envelope) {
                self.0.fetch_add(1, Ordering::SeqCst);
            }
        }
        use sentry::Transport;
        let sink = Arc::new(CountingTransport(std::sync::atomic::AtomicUsize::new(0)));
        let transport = ConsentTransport(sink.clone());
        diagnostics_set_reporting_enabled(false);
        transport.send_envelope(sentry::Envelope::new());
        assert_eq!(sink.0.load(Ordering::SeqCst), 0);
        diagnostics_set_reporting_enabled(true);
        transport.send_envelope(sentry::Envelope::new());
        diagnostics_set_reporting_enabled(false);
        transport.send_envelope(sentry::Envelope::new());
        assert_eq!(sink.0.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn panic_metadata_excludes_content_and_full_paths_and_uses_actual_version() {
        let report = NativePanic::new(Some(("/private/user/project/src/shell.rs", 42)));
        let local = serde_json::to_string(&report).unwrap();
        assert!(!local.contains("/private"));
        assert!(local.contains(env!("CARGO_PKG_VERSION")));
        assert_eq!(report.source_file.as_deref(), Some("shell.rs"));
        assert_eq!(basename(r"C:\Users\person\pty.rs"), "pty.rs");
        let event = report.event();
        assert!(event.user.is_none() && event.request.is_none());
        assert!(event.exception.is_empty() && event.contexts.is_empty());
        assert_eq!(
            event.release.as_deref(),
            Some(concat!("husk@", env!("CARGO_PKG_VERSION")))
        );
    }

    #[test]
    fn local_record_is_bounded_and_corrupt_records_are_nonfatal() {
        let directory = std::env::temp_dir().join(format!(
            "husk-diagnostics-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("panic.json");
        assert!(read_report(&path).unwrap().is_none());
        for line in 1..5 {
            save_report(&path, &NativePanic::new(Some(("fixture.rs", line)))).unwrap();
        }
        assert_eq!(read_report(&path).unwrap().unwrap().source_line, Some(4));
        assert!(std::fs::metadata(&path).unwrap().len() <= MAX_REPORT_BYTES);
        std::fs::write(&path, vec![b'x'; MAX_REPORT_BYTES as usize + 100]).unwrap();
        assert!(read_report(&path).unwrap_err().contains("size limit"));
        std::fs::write(&path, b"{").unwrap();
        assert!(read_report(&path).unwrap_err().contains("incomplete"));
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
