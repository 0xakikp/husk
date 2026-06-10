import { useEffect, useRef, useState, useCallback } from "react";
import {
  loadAccounts,
  saveAccounts,
  newAccountId,
  reorderAccounts,
  type TotpAccount,
} from "./store";
import { generateCode, parseSecretInput, generateQrDataUrl } from "./totp";
import { toast } from "@/toast";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFileBase64 } from "@/fs";
import jsQR from "jsqr";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Upload02Icon,
  Download02Icon,
  QrCodeIcon,
  Cancel01Icon,
  PencilEdit02Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons";

/* ── Countdown progress bar ── */
function CountdownBar({ remaining }: { remaining: number }) {
  const pct = (remaining / 30) * 100;
  const color = remaining <= 5 ? "bg-destructive" : remaining <= 10 ? "bg-amber-500" : "bg-accent";
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`h-full rounded-full transition-all duration-1000 ease-linear ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ── QR display modal ── */
function QrModal({ account, onClose }: { account: TotpAccount; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void generateQrDataUrl(account).then(setUrl);
  }, [account]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-medium">
          {account.issuer ? `${account.issuer} · ` : ""}
          {account.label}
        </p>
        {url ? <img src={url} alt="QR Code" className="rounded-lg" /> : <span className="text-muted-foreground">Generating…</span>}
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/* ── Account row ── */
function AccountRow({
  account,
  selected,
  onCopy,
  onDelete,
  onEdit,
  onShowQr,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  account: TotpAccount;
  selected?: boolean;
  onCopy: (code: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string, label: string) => void;
  onShowQr: (account: TotpAccount) => void;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, id: string) => void;
}) {
  const gen = generateCode(account);
  const [editing, setEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(account.label);

  return (
    <div
      className={`totp-item ${selected ? "totp-item-selected" : ""}`}
      draggable
      onDragStart={() => onDragStart(account.id)}
      onDragOver={(e) => onDragOver(e, account.id)}
      onDrop={(e) => onDrop(e, account.id)}
    >
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {account.issuer ? `${account.issuer} · ` : ""}
            {account.label}
          </span>
          <button
            type="button"
            className="text-muted-foreground/60 hover:text-foreground"
            title="Edit label"
            onClick={() => setEditing(true)}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} size={11} strokeWidth={1.5} />
          </button>
        </div>
        {editing ? (
          <input
            autoFocus
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onBlur={() => {
              onEdit(account.id, editLabel.trim() || account.label);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onEdit(account.id, editLabel.trim() || account.label);
                setEditing(false);
              } else if (e.key === "Escape") {
                setEditLabel(account.label);
                setEditing(false);
              }
            }}
            className="h-6 w-40 rounded border border-border bg-background px-2 text-xs outline-none focus:border-primary"
          />
        ) : (
          <button
            type="button"
            className="totp-code flex items-center gap-1.5"
            title="Click to copy"
            onClick={() => gen && onCopy(gen.code)}
          >
            {gen ? `${gen.code.slice(0, 3)} ${gen.code.slice(3)}` : "------"}
            <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={1.5} />
          </button>
        )}
        {gen ? <CountdownBar remaining={gen.remaining} /> : null}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <span className="totp-remaining">{gen ? `${gen.remaining}s` : "!"}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
            title="Show QR code"
            onClick={() => onShowQr(account)}
          >
            <HugeiconsIcon icon={QrCodeIcon} size={11} strokeWidth={1.5} />
            QR
          </button>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
            title="Edit label"
            onClick={() => setEditing(true)}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} size={11} strokeWidth={1.5} />
            Edit
          </button>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="Remove"
            onClick={() => onDelete(account.id)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.5} />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export function TotpDialog({ onClose, variant = "modal" }: { onClose: () => void; variant?: "modal" | "dropdown" }) {
  const [accounts, setAccounts] = useState<TotpAccount[]>(() =>
    loadAccounts().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  );
  const [, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [qrAccount, setQrAccount] = useState<TotpAccount | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      order: accounts.length,
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
    toast({ title: "Account added", variant: "success", duration: 2000 });
  };

  const handleCopy = useCallback((code: string) => {
    void navigator.clipboard.writeText(code);
    toast({ title: "Code copied to clipboard", variant: "success", duration: 2000 });
  }, []);

  const handleDelete = useCallback((id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    toast({ title: "Account removed", variant: "info", duration: 2000 });
  }, []);

  const handleEdit = useCallback((id: string, newLabel: string) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, label: newLabel } : a)));
  }, []);

  /* ── Drag-to-reorder ── */
  const handleDragStart = (id: string) => {
    dragIdRef.current = id;
  };
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (!dragIdRef.current || dragIdRef.current === id) return;
    setAccounts((prev) => reorderAccounts(prev, dragIdRef.current!, id));
  };
  const handleDrop = (e: React.DragEvent, _id: string) => {
    e.preventDefault();
    dragIdRef.current = null;
  };

  /* ── Import / Export ── */
  const handleExport = async () => {
    const path = await save({
      filters: [{ name: "JSON", extensions: ["json"] }],
      defaultPath: "husk-totp-backup.json",
    });
    if (!path) return;
    const payload = JSON.stringify(accounts, null, 2);
    try {
      const { writeFile } = await import("@/fs");
      await writeFile(path, payload);
      toast({ title: "Exported successfully", variant: "success", duration: 3000 });
    } catch {
      toast({ title: "Export failed", variant: "error", duration: 3000 });
    }
  };

  const handleImport = async () => {
    const paths = await open({
      multiple: false,
      filters: [
        { name: "Backup files", extensions: ["json", "txt"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!paths || Array.isArray(paths)) return;
    try {
      const { readFile } = await import("@/fs");
      const text = await readFile(paths);
      const imported = JSON.parse(text) as TotpAccount[];
      if (!Array.isArray(imported)) throw new Error("Invalid file");
      const valid = imported.filter(
        (a) => a.id && a.secret && typeof a.secret === "string" && a.secret.length >= 4,
      );
      if (valid.length === 0) throw new Error("No valid accounts found");
      setAccounts((prev) => {
        const existingIds = new Set(prev.map((a) => a.id));
        const newOnes = valid
          .filter((a) => !existingIds.has(a.id))
          .map((a, i) => ({ ...a, order: prev.length + i }));
        return [...prev, ...newOnes];
      });
      toast({ title: `Imported ${valid.length} account(s)`, variant: "success", duration: 3000 });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Import failed", variant: "error", duration: 3000 });
    }
  };

  /* ── QR scan from image ── */
  const handleScanQr = async () => {
    const paths = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (!paths || Array.isArray(paths)) return;
    try {
      const b64 = await readFileBase64(paths);
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("Failed to load image"));
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(imageData.data, canvas.width, canvas.height);
      if (!result) {
        toast({ title: "No QR code found in image", variant: "warning", duration: 3000 });
        return;
      }
      const parsed = parseSecretInput(result.data);
      if (!parsed) {
        toast({ title: "QR code does not contain a valid TOTP secret", variant: "warning", duration: 3000 });
        return;
      }
      const account: TotpAccount = {
        id: newAccountId(),
        label: (parsed.label || "Scanned Account").trim(),
        issuer: parsed.issuer,
        secret: parsed.secret,
        order: accounts.length,
      };
      if (!generateCode(account)) {
        toast({ title: "Invalid secret in QR code", variant: "error", duration: 3000 });
        return;
      }
      setAccounts((prev) => [...prev, account]);
      toast({ title: "Account added from QR", variant: "success", duration: 3000 });
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Scan failed", variant: "error", duration: 3000 });
    }
  };

  const filtered = accounts.filter(
    (a) =>
      a.label.toLowerCase().includes(search.toLowerCase()) ||
      (a.issuer ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  /* ── Keyboard navigation ── */
  useEffect(() => {
    if (variant !== "dropdown") return;
    const handler = (e: KeyboardEvent) => {
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedId((prev) => {
          const idx = filtered.findIndex((a) => a.id === prev);
          return filtered[Math.min(idx + 1, filtered.length - 1)].id;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedId((prev) => {
          const idx = filtered.findIndex((a) => a.id === prev);
          return filtered[Math.max(idx - 1, 0)].id;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = filtered.find((a) => a.id === selectedId) || filtered[0];
        const gen = generateCode(target);
        if (gen) handleCopy(gen.code);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, selectedId, handleCopy, onClose, variant]);

  const content = (
    <>
      <div className="modal-header">
        <span>Authenticator</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="ai-icon"
            title="Export accounts"
            onClick={handleExport}
          >
            <HugeiconsIcon icon={Download02Icon} size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="ai-icon"
            title="Import accounts"
            onClick={handleImport}
          >
            <HugeiconsIcon icon={Upload02Icon} size={14} strokeWidth={1.5} />
          </button>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </div>

      <div className="modal-body">
        {/* Search */}
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            size={12}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts…"
            className="h-7 w-full rounded-md border border-muted-foreground/25 bg-background py-0 pr-7 pl-7 text-xs text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-primary"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
            </button>
          )}
        </div>

        {accounts.length === 0 && !adding ? (
          <p className="rb-empty">
            No 2FA accounts yet. Add a base32 secret, scan a QR code, or import a backup.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                selected={a.id === selectedId}
                onCopy={handleCopy}
                onDelete={handleDelete}
                onEdit={handleEdit}
                onShowQr={setQrAccount}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              />
            ))}
            {filtered.length === 0 && search && (
              <p className="text-center text-xs text-muted-foreground">No accounts match &quot;{search}&quot;</p>
            )}
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
          <div className="flex flex-col gap-2">
            <button type="button" className="rb-new" onClick={() => setAdding(true)}>
              + Add account
            </button>
            <button type="button" className="rb-new" onClick={handleScanQr}>
              <HugeiconsIcon icon={QrCodeIcon} size={13} strokeWidth={1.5} className="inline" /> Scan QR from image
            </button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {variant === "dropdown" ? (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div
            className="fixed top-10 right-2 z-50 w-[360px] max-h-[calc(100vh-56px)] flex flex-col bg-card/90 border border-border-2 rounded-xl shadow-2xl overflow-hidden animate-dialog-enter backdrop-blur-md"
            role="dialog"
            aria-label="Authenticator"
            onClick={(e) => e.stopPropagation()}
          >
            {content}
          </div>
        </>
      ) : (
        <div className="modal-backdrop" onClick={onClose}>
          <div
            className="modal"
            role="dialog"
            aria-label="Authenticator"
            onClick={(e) => e.stopPropagation()}
          >
            {content}
          </div>
        </div>
      )}
      {qrAccount && <QrModal account={qrAccount} onClose={() => setQrAccount(null)} />}
    </>
  );
}
