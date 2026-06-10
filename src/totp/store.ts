export type TotpAccount = {
  id: string;
  label: string;
  issuer?: string;
  /** Base32 secret. */
  secret: string;
  /** Order index for drag-to-reorder. */
  order: number;
};

const LS_KEY = "huskv2.totp";

export function loadAccounts(): TotpAccount[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const list = raw ? (JSON.parse(raw) as TotpAccount[]) : [];
    // Migration: old accounts without order field
    return list.map((a, i) => ({ ...a, order: a.order ?? i }));
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

export function reorderAccounts(list: TotpAccount[], fromId: string, toId: string): TotpAccount[] {
  const fromIdx = list.findIndex((a) => a.id === fromId);
  const toIdx = list.findIndex((a) => a.id === toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return list;
  const next = [...list];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next.map((a, i) => ({ ...a, order: i }));
}
