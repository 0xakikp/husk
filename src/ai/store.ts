import { PROVIDERS } from "./providers";

const LS_KEY = "huskv2.ai.config";

export type StoredConfig = {
  providerId: string;
  model: string;
  baseURL: string;
  /** Per-provider API keys, keyed by provider id. */
  keys: Record<string, string>;
};

const DEFAULT: StoredConfig = {
  providerId: PROVIDERS[0].id,
  model: PROVIDERS[0].defaultModel,
  baseURL: PROVIDERS[0].baseURL ?? "",
  keys: {},
};

export function loadConfig(): StoredConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT;
    return { ...DEFAULT, ...(JSON.parse(raw) as Partial<StoredConfig>) };
  } catch {
    return DEFAULT;
  }
}

export function saveConfig(cfg: StoredConfig): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  } catch {
    // storage unavailable — keep config in memory only
  }
}
