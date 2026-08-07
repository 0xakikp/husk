//! Embedded browser engine: native child webviews (Tauri WebviewView).
//!
//! The frontend renders a placeholder div and reports its rect; these commands
//! create/position a native WKWebView (macOS) exactly on top of it. The child
//! webview floats above ALL React UI — including dialogs and the command
//! palette — so the frontend must call `browser_set_visible(false)` whenever
//! the browser panel is not the topmost surface.

use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewUrl,
};

/// Normalise what a person types into the address bar without opening any
/// non-web schemes in the embedded surface. Bare domains use HTTPS, local
/// development hosts use HTTP, and ordinary words become a search.
fn normalize_url(input: &str) -> Result<String, String> {
    let t = input.trim();
    if t.is_empty() {
        return Err("enter a URL or search term".to_string());
    }

    let lower = t.to_ascii_lowercase();
    if lower.contains("://") {
        let parsed: tauri::Url = t.parse().map_err(|e| format!("invalid URL: {e}"))?;
        return match parsed.scheme() {
            "http" | "https" => Ok(parsed.into()),
            scheme => Err(format!("{scheme}: links cannot open inside Husk")),
        };
    }
    if let Some((scheme, _)) = lower.split_once(':') {
        if matches!(
            scheme,
            "file" | "mailto" | "javascript" | "data" | "tel" | "about"
        ) {
            return Err(format!("{scheme}: links cannot open inside Husk"));
        }
    }

    let is_local = lower == "localhost"
        || lower.starts_with("localhost:")
        || lower.starts_with("localhost/")
        || lower.starts_with("127.")
        || lower.starts_with("[::1]");
    let candidate =
        if t.contains(char::is_whitespace) || (!t.contains('.') && !t.contains(':') && !is_local) {
            format!("https://www.google.com/search?q={}", urlencoding::encode(t))
        } else if is_local {
            format!("http://{t}")
        } else {
            format!("https://{t}")
        };

    let parsed: tauri::Url = candidate.parse().map_err(|e| format!("invalid URL: {e}"))?;
    if parsed.host_str().is_none() {
        return Err("enter a complete web address".to_string());
    }
    Ok(parsed.into())
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
    let parsed: tauri::Url = normalize_url(&url)?
        .parse()
        .map_err(|e| format!("invalid URL {url}: {e}"))?;

    // Idempotent: an existing webview just gets re-parked over the new rect.
    if let Some(wv) = window.get_webview(&label) {
        wv.set_position(position).map_err(|e| e.to_string())?;
        wv.set_size(size).map_err(|e| e.to_string())?;
        wv.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let app_handle = app.clone();
    let nav_label = label.clone();
    let popup_handle = app.clone();
    let popup_label = label.clone();
    let load_handle = app.clone();
    let load_label = label.clone();
    let builder = tauri::WebviewBuilder::new(&label, WebviewUrl::External(parsed)).on_navigation(
        move |nav_url| {
            let _ = app_handle.emit_to(
                "main",
                "browser://nav",
                serde_json::json!({ "label": nav_label, "url": nav_url.as_str() }),
            );
            true // allow every navigation
        },
    ).on_new_window(move |popup_url, _| {
        // A child browser has one surface rather than a tab strip. Let links
        // that request a new window continue in that same surface; reject
        // non-web schemes instead of handing them to a privileged webview.
        if matches!(popup_url.scheme(), "http" | "https") {
            let _ = popup_handle.emit_to(
                "main",
                "browser://nav",
                serde_json::json!({ "label": popup_label, "url": popup_url.as_str() }),
            );
            if let Some(webview) = popup_handle.get_webview(&popup_label) {
                let _ = webview.navigate(popup_url);
            }
        }
        NewWindowResponse::Deny
    }).on_page_load(move |_, payload| {
        let phase = match payload.event() {
            PageLoadEvent::Started => "started",
            PageLoadEvent::Finished => "finished",
        };
        let _ = load_handle.emit_to(
            "main",
            "browser://load",
            serde_json::json!({ "label": load_label, "url": payload.url().as_str(), "phase": phase }),
        );
    });

    window
        .add_child(builder, position, size)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or("browser is not open")?;
    let parsed: tauri::Url = normalize_url(&url)?
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

#[cfg(test)]
mod tests {
    use super::normalize_url;

    #[test]
    fn turns_words_into_a_search() {
        assert_eq!(
            normalize_url("husk terminal").unwrap(),
            "https://www.google.com/search?q=husk%20terminal"
        );
    }

    #[test]
    fn accepts_bare_and_local_hosts() {
        assert_eq!(
            normalize_url("example.com/docs").unwrap(),
            "https://example.com/docs"
        );
        assert_eq!(
            normalize_url("localhost:3000").unwrap(),
            "http://localhost:3000/"
        );
    }

    #[test]
    fn rejects_non_web_schemes() {
        assert!(normalize_url("file:///etc/passwd").is_err());
        assert!(normalize_url("mailto:hello@example.com").is_err());
    }
}
