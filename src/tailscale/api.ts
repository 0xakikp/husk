import { invoke } from "@tauri-apps/api/core";

export interface TailscaleDevice {
  id: string;
  name: string;
  ipv4: string;
  ipv6?: string;
  os: string;
  online: boolean;
  user: string;
  tags: string[];
  ssh_enabled: boolean;
  last_seen: string;
}

export interface TailscalePrefs {
  api_key: string;
  tailnet: string;
}

export interface TailscaleDeviceList {
  devices: TailscaleDevice[];
}

export interface TailscaleSshRequest {
  device_ip: string;
  user: string;
}

export interface TailscaleSshResponse {
  success: boolean;
  command: string;
  message: string;
}

export async function listDevices(): Promise<TailscaleDevice[]> {
  const result = await invoke<TailscaleDeviceList>("tailscale_list_devices");
  return result.devices;
}

export async function testConnection(): Promise<boolean> {
  return await invoke<boolean>("tailscale_test_connection");
}

export async function setPrefs(prefs: TailscalePrefs): Promise<void> {
  await invoke("tailscale_set_prefs", { prefs });
}

export async function getPrefs(): Promise<TailscalePrefs | null> {
  return await invoke<TailscalePrefs | null>("tailscale_get_prefs");
}

export async function generateSshCommand(req: TailscaleSshRequest): Promise<TailscaleSshResponse> {
  return await invoke<TailscaleSshResponse>("tailscale_generate_ssh_command", { request: req });
}
