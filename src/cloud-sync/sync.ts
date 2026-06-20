export type CloudSyncData = {
  version: number;
  exportedAt: number;
  connections: unknown[];
  bookmarks: unknown[];
  snippets: unknown[];
  settings: Record<string, unknown>;
  sshConfig: string;
};

const CURRENT_VERSION = 1;

export function exportSettings(): CloudSyncData {
  const connections = JSON.parse(localStorage.getItem("huskv2.connections") || "[]");
  const bookmarks = JSON.parse(localStorage.getItem("huskv2.bookmarks") || "[]");
  const snippets = JSON.parse(localStorage.getItem("huskv2.snippets") || "[]");
  const settings = JSON.parse(localStorage.getItem("huskv2.preferences") || "{}");
  const sshConfig = localStorage.getItem("huskv2.sshConfig") || "";

  return {
    version: CURRENT_VERSION,
    exportedAt: Date.now(),
    connections,
    bookmarks,
    snippets,
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
    if (data.snippets?.length) {
      localStorage.setItem("huskv2.snippets", JSON.stringify(data.snippets));
      result.imported.push(`${data.snippets.length} snippets`);
    }
  } catch (e) { result.errors.push(`Snippets: ${e}`); }

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

export function encryptData(data: CloudSyncData, passphrase: string): string {
  const json = JSON.stringify(data);
  // Simple XOR-based encryption (not production-grade, but portable)
  // For real security, use Web Crypto API or a proper library
  const key = passphrase.split("").map((c) => c.charCodeAt(0));
  const bytes = new TextEncoder().encode(json);
  const encrypted = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    encrypted[i] = bytes[i] ^ key[i % key.length];
  }
  return btoa(String.fromCharCode(...encrypted));
}

export function decryptData(encrypted: string, passphrase: string): CloudSyncData {
  const key = passphrase.split("").map((c) => c.charCodeAt(0));
  const bytes = new Uint8Array(
    atob(encrypted).split("").map((c) => c.charCodeAt(0))
  );
  const decrypted = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    decrypted[i] = bytes[i] ^ key[i % key.length];
  }
  const json = new TextDecoder().decode(decrypted);
  return JSON.parse(json);
}
