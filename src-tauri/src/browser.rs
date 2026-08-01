//! Embedded browser engine: native child webviews (Tauri WebviewView).
//!
//! The frontend renders a placeholder div and reports its rect; these commands
//! create/position a native WKWebView (macOS) exactly on top of it. The child
//! webview floats above ALL React UI — including dialogs and the command
//! palette — so the frontend must call `browser_set_visible(false)` whenever
//! the browser panel is not the topmost surface.

use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl};

/// Bare host ("example.com" or "localhost:3000") gets https://; anything with
/// spaces or without a dot is treated as a web search.
fn normalize_url(input: &str) -> String {
    let t = input.trim();
    if t.starts_with("http://") || t.starts_with("https://") {
        return t.to_string();
    }
    if t.contains(' ') || !t.contains('.') {
        return format!(
            "https://www.google.com/search?q={}",
            urlencoding::encode(t)
        );
    }
    format!("https://{t}")
}

#[tauri::command]
pub fn browser_create(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let window = app.get_window("main").ok_or("main window not found")?;
    let position = Position::Logical(LogicalPosition::new(x, y));
    let size = Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0)));

    // Idempotent: an existing webview just gets re-parked over the new rect.
    if let Some(wv) = window.get_webview(&label) {
        wv.set_position(position).map_err(|e| e.to_string())?;
        wv.set_size(size).map_err(|e| e.to_string())?;
        wv.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let parsed: tauri::Url = normalize_url(&url)
        .parse()
        .map_err(|e| format!("invalid url {url}: {e}"))?;

    let app_handle = app.clone();
    let nav_label = label.clone();
    let builder = tauri::WebviewBuilder::new(&label, WebviewUrl::External(parsed)).on_navigation(
        move |nav_url| {
            let _ = app_handle.emit_to(
                "main",
                "browser://nav",
                serde_json::json!({ "label": nav_label, "url": nav_url.as_str() }),
            );
            true // allow every navigation
        },
    );

    window
        .add_child(builder, position, size)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or("browser is not open")?;
    let parsed: tauri::Url = normalize_url(&url)
        .parse()
        .map_err(|e| format!("invalid url {url}: {e}"))?;
    wv.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_go(app: AppHandle, label: String, action: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or("browser is not open")?;
    let js = match action.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "reload" => "location.reload()",
        other => return Err(format!("unknown browser action: {other}")),
    };
    wv.eval(js).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or("browser is not open")?;
    wv.set_position(Position::Logical(LogicalPosition::new(x, y)))
        .map_err(|e| e.to_string())?;
    wv.set_size(Size::Logical(LogicalSize::new(
        width.max(1.0),
        height.max(1.0),
    )))
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_set_visible(app: AppHandle, label: String, visible: bool) -> Result<(), String> {
    // Not an error when the webview is gone (e.g. closed before a queued hide).
    let Some(wv) = app.get_webview(&label) else {
        return Ok(());
    };
    if visible {
        wv.show().map_err(|e| e.to_string())
    } else {
        wv.hide().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn browser_close(app: AppHandle, label: String) -> Result<(), String> {
    let Some(wv) = app.get_webview(&label) else {
        return Ok(());
    };
    wv.close().map_err(|e| e.to_string())
}
