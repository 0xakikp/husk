import { useEffect, useState } from "react";
import { loadAccounts, saveAccounts, newAccountId, type TotpAccount } from "./store";
import { generateCode, parseSecretInput } from "./totp";

export function TotpDialog({ onClose }: { onClose: () => void }) {
  const [accounts, setAccounts] = useState<TotpAccount[]>(() => loadAccounts());
  const [, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  useEffect(() => saveAccounts(accounts), [accounts]);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const add = () => {
    const parsed = parseSecretInput(secret);
    if (!parsed) {
      setError("Enter a base32 secret or an otpauth:// URI");
      return;
    }
    const account: TotpAccount = {
      id: newAccountId(),
      label: (parsed.label || label).trim() || "Account",
      issuer: parsed.issuer,
      secret: parsed.secret,
    };
    if (!generateCode(account)) {
      setError("That secret isn't valid base32");
      return;
    }
    setAccounts((prev) => [...prev, account]);
    setLabel("");
    setSecret("");
    setError("");
    setAdding(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Authenticator"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>Authenticator</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          {accounts.length === 0 && !adding ? (
            <p className="rb-empty">
              No 2FA accounts yet. Add a base32 secret or an otpauth:// URI to generate
              time-based codes.
            </p>
          ) : (
            <div className="rb-list">
              {accounts.map((a) => {
                const gen = generateCode(a);
                return (
                  <div key={a.id} className="totp-item">
                    <div className="rb-meta">
                      <span className="rb-name">
                        {a.issuer ? `${a.issuer} · ` : ""}
                        {a.label}
                      </span>
                      <button
                        type="button"
                        className="totp-code"
                        title="Copy code"
                        onClick={() => gen && void navigator.clipboard.writeText(gen.code)}
                      >
                        {gen ? `${gen.code.slice(0, 3)} ${gen.code.slice(3)}` : "------"}
                      </button>
                    </div>
                    <span className="totp-remaining">{gen ? `${gen.remaining}s` : "!"}</span>
                    <button
                      type="button"
                      className="ai-icon"
                      aria-label={`Remove ${a.label}`}
                      onClick={() => setAccounts((p) => p.filter((x) => x.id !== a.id))}
                    >
                      🗑
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {adding ? (
            <div className="totp-add">
              <label className="rb-field">
                <span>Label</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="GitHub"
                />
              </label>
              <label className="rb-field">
                <span>Secret or otpauth:// URI</span>
                <input
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="JBSWY3DPEHPK3PXP"
                />
              </label>
              {error ? <p className="totp-error">{error}</p> : null}
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="primary" onClick={add}>
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="rb-new" onClick={() => setAdding(true)}>
              + Add account
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
