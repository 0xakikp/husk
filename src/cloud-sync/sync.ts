export type CloudSyncData = {
  version: number;
  exportedAt: number;
  connections: unknown[];
  bookmarks: unknown[];
  settings: Record<string, unknown>;
  sshConfig: string;
};

const CURRENT_VERSION = 1;
const KEY_ITERATIONS = 100_000;
const SALT_LEN = 16;
const IV_LEN = 12;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: KEY_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function encodeBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decodeBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

export function exportSettings(): CloudSyncData {
  const connections = JSON.parse(localStorage.getItem("huskv2.connections") || "[]");
  const bookmarks = JSON.parse(localStorage.getItem("huskv2.bookmarks") || "[]");
  const settings = JSON.parse(localStorage.getItem("huskv2.preferences") || "{}");
  const sshConfig = localStorage.getItem("huskv2.sshConfig") || "";

  return {
    version: CURRENT_VERSION,
    exportedAt: Date.now(),
    connections,
    bookmarks,
    settings,
    sshConfig,
  };
}

export function importSettings(data: CloudSyncData): { success: boolean; imported: string[]; errors: string[] } {
  const result = { success: true, imported: [] as string[], errors: [] as string[] };

  if (data.version > CURRENT_VERSION) {
    result.errors.push(`Unsupported backup version: ${data.version}`);
    result.success = false;
    return result;
  }

  try {
    if (data.connections?.length) {
      localStorage.setItem("huskv2.connections", JSON.stringify(data.connections));
      result.imported.push(`${data.connections.length} connections`);
    }
  } catch (e) { result.errors.push(`Connections: ${e}`); }

  try {
    if (data.bookmarks?.length) {
      localStorage.setItem("huskv2.bookmarks", JSON.stringify(data.bookmarks));
      result.imported.push(`${data.bookmarks.length} bookmarks`);
    }
  } catch (e) { result.errors.push(`Bookmarks: ${e}`); }

  try {
    if (Object.keys(data.settings || {}).length) {
      localStorage.setItem("huskv2.preferences", JSON.stringify(data.settings));
      result.imported.push("settings");
    }
  } catch (e) { result.errors.push(`Settings: ${e}`); }

  try {
    if (data.sshConfig) {
      localStorage.setItem("huskv2.sshConfig", data.sshConfig);
      result.imported.push("SSH config");
    }
  } catch (e) { result.errors.push(`SSH config: ${e}`); }

  return result;
}

export async function encryptData(data: CloudSyncData, passphrase: string): Promise<string> {
  const encoder = new TextEncoder();
  const json = JSON.stringify(data);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(json)
  );
  const combined = new Uint8Array(SALT_LEN + IV_LEN + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LEN);
  combined.set(new Uint8Array(ciphertext), SALT_LEN + IV_LEN);
  return encodeBase64(combined);
}

export async function decryptData(encrypted: string, passphrase: string): Promise<CloudSyncData> {
  const combined = decodeBase64(encrypted);
  if (combined.length < SALT_LEN + IV_LEN) {
    throw new Error("Invalid encrypted data");
  }
  const salt = combined.slice(0, SALT_LEN);
  const iv = combined.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const ciphertext = combined.slice(SALT_LEN + IV_LEN);
  const key = await deriveKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  const json = new TextDecoder().decode(decrypted);
  return JSON.parse(json);
}
