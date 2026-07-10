const LS_KEYS = [
  "huskv2.connections",
  "huskv2.bookmarks",
  "huskv2.sshConfig",
  "huskv2.settings",
];

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

async function encrypt(text: string, passphrase: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(text)
  );
  const combined = new Uint8Array(SALT_LEN + IV_LEN + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LEN);
  combined.set(new Uint8Array(ciphertext), SALT_LEN + IV_LEN);
  return encodeBase64(combined);
}

async function decrypt(b64: string, passphrase: string): Promise<string> {
  const combined = decodeBase64(b64);
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
  return new TextDecoder().decode(decrypted);
}

export async function exportSettings(passphrase: string): Promise<string> {
  const payload: Record<string, string | null> = {};
  for (const key of LS_KEYS) {
    payload[key] = localStorage.getItem(key);
  }
  return encrypt(JSON.stringify(payload), passphrase);
}

export async function importSettings(blob: string, passphrase: string): Promise<void> {
  const decrypted = await decrypt(blob, passphrase);
  const payload = JSON.parse(decrypted) as Record<string, string | null>;
  for (const key of LS_KEYS) {
    if (payload[key] !== undefined && payload[key] !== null) {
      localStorage.setItem(key, payload[key]);
    } else {
      localStorage.removeItem(key);
    }
  }
}
