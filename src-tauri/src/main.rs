// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use sentry::ClientInitGuard;

fn init_sentry() -> Option<ClientInitGuard> {
    // Placeholder DSN — replace with real one from sentry.io
    let dsn = "https://public@o0.ingest.sentry.io/0";
    if dsn.contains("@o0.ingest") {
        // Not configured yet — skip
        return None;
    }
    Some(sentry::init((
        dsn,
        sentry::ClientOptions {
            release: Some("husk@0.2.4".into()),
            environment: Some(
                if cfg!(debug_assertions) { "development" } else { "production" }.into()
            ),
            ..Default::default()
        },
    )))
}

fn main() {
    let _sentry = init_sentry();
    husk_lib::run()
}
