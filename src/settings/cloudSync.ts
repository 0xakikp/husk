const LS_KEYS = [
  "huskv2.connections",
  "huskv2.bookmarks",
  "huskv2.sshConfig",
  "huskv2.settings",
];

function xorEncrypt(text: string, key: string): string {
  const keyBytes = new TextEncoder().encode(key);
  const textBytes = new TextEncoder().encode(text);
  const out = new Uint8Array(textBytes.length);
  for (let i = 0; i < textBytes.length; i++) {
    out[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return btoa(String.fromCharCode(...out));
}

function xorDecrypt(b64: string, key: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const keyBytes = new TextEncoder().encode(key);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return new TextDecoder().decode(out);
}

export function exportSettings(passphrase: string): string {
  const payload: Record<string, string | null> = {};
  for (const key of LS_KEYS) {
    payload[key] = localStorage.getItem(key);
  }
  return xorEncrypt(JSON.stringify(payload), passphrase);
}

export function importSettings(blob: string, passphrase: string): void {
  const decrypted = xorDecrypt(blob, passphrase);
  const payload = JSON.parse(decrypted) as Record<string, string | null>;
  for (const key of LS_KEYS) {
    if (payload[key] !== undefined && payload[key] !== null) {
      localStorage.setItem(key, payload[key]);
    } else {
      localStorage.removeItem(key);
    }
  }
}
