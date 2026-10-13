import { useEffect, useId, useRef, useState } from "react";
import { CompactForm, CompactInput, CompactLabel, CompactButton } from "../components/compact-form";
import { sftpConnect, sftpDisconnect, type SftpConnectionResult } from "../remote/sftpApi";
import { decodeSftpTarget, sftpTargetLabel, type SftpTarget } from "./sftpTarget";
import { useSftpTargetPreview } from "./useSftpTargetPreview";

export function SftpConnectPanel({ reference, sessionKey, active, onConnected, onClose }: {
  reference: string; sessionKey: string; active: boolean;
  onConnected: (result: SftpConnectionResult) => void; onClose: () => void;
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [encryptedKey, setEncryptedKey] = useState(false);
  const [pending, setPending] = useState<SftpConnectionResult | null>(null);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const accepted = useRef(false);
  const visible = useRef(active); visible.current = active;
  useEffect(() => {
    accepted.current = false;
    return () => {
      request.current++;
      if (!accepted.current) void sftpDisconnect(sessionKey).catch(() => {});
    };
  }, [sessionKey, reference]);
  useEffect(() => { if (!active) { request.current++; setPassword(""); setPassphrase(""); setPending(null); setVerified(false); setBusy(false); void sftpDisconnect(sessionKey).catch(() => {}); } }, [active, sessionKey]);
  let target: SftpTarget | null = null;
  try { target = decodeSftpTarget(reference); }
  catch { /* Invalid targets must not trigger even a metadata lookup. */ }
  const { preview, loading, error: previewError, refresh } = useSftpTargetPreview(target, active);
  useEffect(() => {
    request.current++;
    setPending(null); setVerified(false); setPassword(""); setPassphrase(""); setEncryptedKey(false); setError(""); setBusy(false);
  }, [reference, sessionKey]);
  if (!target) return <div className="p-4 text-sm"><p role="alert">This SFTP connection is invalid. Choose a connection from Remotes again.</p><button type="button" onClick={onClose}>Close</button></div>;
  const connect = async () => {
    if (!active || busy || !target || !preview || loading || previewError || (pending && !verified)) return;
    const current = ++request.current;
    setBusy(true); setError("");
    try {
      const result = await sftpConnect(sessionKey, target, {
        ...(target.authType === "password" && password ? { password } : {}),
        ...(target.authType !== "agent" && target.authType !== "password" && passphrase ? { passphrase } : {}),
      }, pending?.fingerprint, preview.reviewKey);
      // Hide/cancel already disconnected the native generation. A stale reply
      // must not disconnect a newer connection started after returning here.
      if (current !== request.current || !visible.current) return;
      if (result.status === "verify-host") { setPending(result); setVerified(false); }
      else { accepted.current = true; setPassword(""); setPassphrase(""); onConnected(result); }
    } catch (failure) {
      if (current === request.current && visible.current) {
        setError(String(failure)); setPassword(""); setPassphrase("");
        // Native verification challenges are single-use. A failed attempt must
        // start fresh rather than reusing an old target/fingerprint approval.
        setPending(null); setVerified(false);
      }
    } finally { if (current === request.current) setBusy(false); }
  };
  return <div className="h-full overflow-auto bg-background p-4">
    <div className="mx-auto max-w-lg">
      <h2 className="mb-4 text-sm font-semibold">Browse remote files</h2>
      <CompactForm>
        <div className="compact-section">
          <strong className="break-all">{preview ? `${preview.username}@${preview.hostname}:${preview.port}` : sftpTargetLabel(target)}</strong>
          <p className="compact-hint">{preview ? `User: ${preview.username} · Port: ${preview.port}` : loading ? "Reading local SSH configuration…" : "Connection details could not be resolved."}</p>
          {preview && target.host !== preview.hostname && <p className="compact-hint break-all">SSH alias: {target.host}</p>}
          <p className="compact-hint">Authentication: {target.authType === "agent" ? "SSH agent" : target.authType === "key" ? "Private key" : target.authType === "password" ? "Password" : "SSH config / available keys"}{target.identityFile ? ` · ${target.identityFile}` : ""}</p>
          <CompactButton compact variant="ghost" disabled={busy || loading} onClick={() => { request.current++; setPending(null); setVerified(false); setPassword(""); setPassphrase(""); setError(""); void sftpDisconnect(sessionKey).catch(() => {}); refresh(); }}>Refresh connection details</CompactButton>
          {target.jumpHost && <p role="status" className="compact-error">Jump host: {target.jumpHost}. SFTP through jump hosts is not supported yet; Husk will not bypass it.</p>}
          <p className="compact-hint">Connect opens a separate SSH/SFTP session and lists its starting folder. It does not reuse your terminal login, sudo privileges or current directory. No automatic uploads, sync or AI sharing.</p>
        </div>
        {target.authType === "password" ? <div className="compact-field">
          <CompactLabel htmlFor={`${id}-password`}>Password · this connection only</CompactLabel>
          <CompactInput id={`${id}-password`} type="password" value={password} autoComplete="off" onChange={event => setPassword(event.target.value)} disabled={busy} />
        </div> : target.authType === "agent" ? <p className="compact-hint">Uses keys from the app’s SSH agent. No password or key passphrase is entered here.</p> : target.authType === "key" || encryptedKey ? <div className="compact-field">
          <CompactLabel htmlFor={`${id}-passphrase`}>Key passphrase (if required) · not saved</CompactLabel>
          <CompactInput id={`${id}-passphrase`} type="password" value={passphrase} autoComplete="off" onChange={event => setPassphrase(event.target.value)} disabled={busy} />
        </div> : <CompactButton compact variant="ghost" disabled={busy} onClick={() => setEncryptedKey(true)}>Use an encrypted key…</CompactButton>}
        {pending && <section className="compact-section" aria-label="Verify server identity">
          <strong>Verify server identity before signing in</strong>
          <p className="compact-hint break-all">{pending.username}@{pending.hostname}:{pending.port}</p>
          <code className="block break-all text-xs">{pending.fingerprint}</code>
          <p className="compact-hint">Compare this fingerprint through a trusted channel. A matching hostname alone does not verify the server.</p>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} disabled={busy} />I verified this fingerprint independently</label>
        </section>}
        {(previewError || error) && <p role="alert" className="compact-error break-words">{previewError || error}</p>}
        <div className="compact-actions">
          <CompactButton type="button" onClick={() => { request.current++; setPassword(""); setPassphrase(""); void sftpDisconnect(sessionKey).catch(() => {}); onClose(); }}>Cancel</CompactButton>
          <CompactButton type="button" variant="primary" disabled={!active || busy || loading || !preview || !!previewError || !!target.jumpHost || (!!pending && !verified)} onClick={() => void connect()}>{busy ? "Connecting…" : pending ? "Trust verified key & connect" : "Connect & browse"}</CompactButton>
        </div>
      </CompactForm>
    </div>
  </div>;
}
