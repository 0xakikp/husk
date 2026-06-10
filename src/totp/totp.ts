import { TOTP, Secret, URI } from "otpauth";
import type { TotpAccount } from "./store";
import QRCode from "qrcode";

const PERIOD = 30;

/** Current code + seconds remaining, or null if the secret is invalid. */
export function generateCode(account: TotpAccount): { code: string; remaining: number } | null {
  try {
    const totp = new TOTP({
      issuer: account.issuer,
      label: account.label,
      secret: Secret.fromBase32(account.secret.replace(/\s/g, "").toUpperCase()),
    });
    return {
      code: totp.generate(),
      remaining: PERIOD - (Math.floor(Date.now() / 1000) % PERIOD),
    };
  } catch {
    return null;
  }
}

/** Accept a base32 secret or an otpauth:// URI. */
export function parseSecretInput(
  input: string,
): { label?: string; issuer?: string; secret: string } | null {
  const t = input.trim();
  if (t.toLowerCase().startsWith("otpauth://")) {
    try {
      const parsed = URI.parse(t);
      if (parsed instanceof TOTP) {
        return {
          label: parsed.label,
          issuer: parsed.issuer || undefined,
          secret: parsed.secret.base32,
        };
      }
    } catch {
      return null;
    }
    return null;
  }
  const secret = t.replace(/\s/g, "").toUpperCase();
  return secret ? { secret } : null;
}

/** Generate a QR code data URL for an account. */
export async function generateQrDataUrl(account: TotpAccount): Promise<string | null> {
  try {
    const totp = new TOTP({
      issuer: account.issuer || "",
      label: account.label,
      secret: Secret.fromBase32(account.secret.replace(/\s/g, "").toUpperCase()),
    });
    const uri = totp.toString();
    return await QRCode.toDataURL(uri, { margin: 1, width: 200 });
  } catch {
    return null;
  }
}
