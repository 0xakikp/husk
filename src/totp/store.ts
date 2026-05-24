export type TotpAccount = {
  id: string;
  label: string;
  issuer?: string;
  /** Base32 secret. */
  secret: string;
};

const LS_KEY = "huskv2.totp";

export function loadAccounts(): TotpAccount[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as TotpAccount[]) : [];
  } catch {
    return [];
  }
}

export function saveAccounts(list: TotpAccount[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — keep in memory only
  }
}

export function newAccountId(): string {
  return `totp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
