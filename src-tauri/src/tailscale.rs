use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TailscaleDevice {
    pub id: String,
    pub name: String,
    pub ipv4: String,
    pub ipv6: Option<String>,
    pub os: String,
    pub online: bool,
    pub user: String,
    pub tags: Vec<String>,
    pub ssh_enabled: bool,
    pub last_seen: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TailscalePrefs {
    pub api_key: String,
    pub tailnet: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TailscaleDeviceList {
    pub devices: Vec<TailscaleDevice>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TailscaleSshRequest {
    pub device_ip: String,
    pub user: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TailscaleSshResponse {
    pub success: bool,
    pub command: String,
    pub message: String,
}

#[derive(Default)]
pub struct TailscaleState {
    prefs: std::sync::Mutex<Option<TailscalePrefs>>,
}

#[tauri::command]
pub async fn tailscale_list_devices(
    state: State<'_, TailscaleState>,
) -> Result<TailscaleDeviceList, String> {
    let (api_key, tailnet) = {
        let prefs = state.prefs.lock().map_err(|e| e.to_string())?;
        let prefs = prefs
            .as_ref()
            .ok_or("Tailscale not configured. Add API key in settings.")?;
        (prefs.api_key.clone(), prefs.tailnet.clone())
    };

    let client = reqwest::Client::new();
    let url = format!(
        "https://api.tailscale.com/api/v2/tailnet/{}/devices",
        tailnet
    );

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch devices: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Tailscale API error {}: {}", status, text));
    }

    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let devices = data["devices"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|d| TailscaleDevice {
            id: d["id"].as_str().unwrap_or("").to_string(),
            name: d["name"].as_str().unwrap_or("").to_string(),
            ipv4: d["addresses"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|ip| ip.as_str())
                .unwrap_or("")
                .to_string(),
            ipv6: d["addresses"]
                .as_array()
                .and_then(|a| a.get(1))
                .and_then(|ip| ip.as_str())
                .map(|s| s.to_string()),
            os: d["os"].as_str().unwrap_or("unknown").to_string(),
            online: d["online"].as_bool().unwrap_or(false),
            user: d["user"].as_str().unwrap_or("").to_string(),
            tags: d["tags"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|t| t.as_str().map(|s| s.to_string()))
                .collect(),
            ssh_enabled: d["ssh"].as_bool().unwrap_or(false),
            last_seen: d["lastSeen"].as_str().unwrap_or("").to_string(),
        })
        .collect();

    Ok(TailscaleDeviceList { devices })
}

#[tauri::command]
pub async fn tailscale_test_connection(state: State<'_, TailscaleState>) -> Result<bool, String> {
    let (api_key, tailnet) = {
        let prefs = state.prefs.lock().map_err(|e| e.to_string())?;
        let prefs = prefs.as_ref().ok_or("Not configured")?;
        (prefs.api_key.clone(), prefs.tailnet.clone())
    };

    let client = reqwest::Client::new();
    let url = format!(
        "https://api.tailscale.com/api/v2/tailnet/{}/devices",
        tailnet
    );

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(response.status().is_success())
}

#[tauri::command]
pub async fn tailscale_set_prefs(
    state: State<'_, TailscaleState>,
    prefs: TailscalePrefs,
) -> Result<(), String> {
    let mut guard = state.prefs.lock().map_err(|e| e.to_string())?;
    *guard = Some(prefs);
    Ok(())
}

#[tauri::command]
pub async fn tailscale_get_prefs(
    state: State<'_, TailscaleState>,
) -> Result<Option<TailscalePrefs>, String> {
    let guard = state.prefs.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub async fn tailscale_generate_ssh_command(
    request: TailscaleSshRequest,
) -> Result<TailscaleSshResponse, String> {
    let ssh_command = if request.user.is_empty() {
        format!("ssh {}", request.device_ip)
    } else {
        format!("ssh {}@{}", request.user, request.device_ip)
    };

    Ok(TailscaleSshResponse {
        success: true,
        command: ssh_command,
        message: "Tailscale SSH uses your tailnet ACLs for authorization. No password needed."
            .to_string(),
    })
}
