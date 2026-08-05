// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use sentry::ClientInitGuard;

fn init_sentry() -> Option<ClientInitGuard> {
    let dsn = "https://4f0f3f635fe76c93a1f870b365b5aba5@o4511596996067328.ingest.de.sentry.io/4511597298647120";
    Some(sentry::init((
        dsn,
        sentry::ClientOptions {
            release: Some("husk@0.3.0".into()),
            environment: Some(
                if cfg!(debug_assertions) {
                    "development"
                } else {
                    "production"
                }
                .into(),
            ),
            ..Default::default()
        },
    )))
}

fn main() {
    let _sentry = init_sentry();
    husk_lib::run()
}
