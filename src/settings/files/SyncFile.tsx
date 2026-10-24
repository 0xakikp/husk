import { useState } from "react";
import { useSettingsDraft } from "../settingsDrafts";
import { toast } from "../../toast";
import { exportSettings, prepareSettingsImport, applySettingsImport, BACKUP_EXCLUSIONS, type SettingsImportPreview } from "../cloudSync";
import { ConfigEditor, CfgArt, CfgBlank, CfgBlock, CfgComment, CfgEnum, CfgRow, CfgSection, CfgText } from "../config/controls";
import { BANNERS } from "../config/banners";

export function SyncFile() {
  const [mode, setMode] = useState<"export" | "import">("export");
  const [passphrase, setPassphrase] = useState("");
  const [blob, setBlob] = useState("");
  const [preview, setPreview] = useState<SettingsImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  useSettingsDraft(false, "Settings backup", busy);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);

  const report = (text: string, error = false) => {
    setFeedback({ text, error });
    toast({ title: text, variant: error ? "error" : "success" });
  };
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    try { await operation(); }
    catch (error) { report(error instanceof Error ? error.message : "Could not complete this backup operation.", true); }
    finally { setBusy(false); }
  };

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.sync} />
      <CfgBlank />
      <CfgComment>Encrypted settings backup · created locally, shared only when you choose.</CfgComment>
      <CfgComment>Includes preferences, AI provider/model, agent and prompt definitions, appearance presets, and file/folder bookmarks.</CfgComment>
      <CfgComment>{BACKUP_EXCLUSIONS}</CfgComment>
      <CfgComment>Prompts, personal instructions, and paths can contain private text. Keep the backup and passphrase private.</CfgComment>
      <CfgBlank />
      <CfgSection name="backup" />
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="sr-only">Encrypted settings backup</legend>
        <CfgRow name="mode" comment="Export a portable backup, or review one before merging it.">
          <CfgEnum value={mode} onChange={(next) => { setMode(next); setBlob(""); setPreview(null); setFeedback(null); }} options={[{ value: "export", label: "Export" }, { value: "import", label: "Import" }]} />
        </CfgRow>
        <CfgRow name="passphrase" comment="At least 8 characters. Remember it: Husk cannot recover a forgotten passphrase.">
          <CfgText secret value={passphrase} onChange={(value) => { setPassphrase(value); setPreview(null); setFeedback(null); if (mode === "export") setBlob(""); }} placeholder="Your backup passphrase" widthCh={28} />
        </CfgRow>
        {mode === "export" ? (
          <>
            <CfgRow>
              <button type="button" className="cfg-act" onClick={() => void run(async () => {
                setBlob("");
                const encrypted = await exportSettings(passphrase);
                setBlob(encrypted);
                report("Encrypted backup created. Copy it to save or transfer it.");
              })}>[ Generate encrypted backup ]</button>
            </CfgRow>
            {blob && <>
              <CfgRow name="encrypted_backup" comment="Encrypted text — no automatic upload or clipboard access."><CfgBlock value={blob} readOnly rows={6} /></CfgRow>
              <CfgRow><button type="button" className="cfg-act" onClick={() => void run(async () => {
                try { await navigator.clipboard.writeText(blob); }
                catch { throw new Error("Clipboard access failed. Select and copy the encrypted text manually."); }
                report("Encrypted backup copied to clipboard.");
              })}>[ Copy encrypted backup ]</button></CfgRow>
            </>}
          </>
        ) : (
          <>
            <CfgRow name="encrypted_backup" comment="Paste the encrypted text. Nothing is written until you review and confirm.">
              <CfgBlock value={blob} onChange={(value) => { setBlob(value); setPreview(null); setFeedback(null); }} rows={6} placeholder="husk-settings:v1:…" />
            </CfgRow>
            <CfgRow><button type="button" className="cfg-act" onClick={() => void run(async () => {
              setPreview(null);
              const reviewed = await prepareSettingsImport(blob, passphrase);
              setPreview(reviewed);
            })}>[ Review backup ]</button></CfgRow>
            {preview && <section aria-label="Backup import preview">
              <CfgSection name="review_import" />
              <CfgComment>Backup created {new Date(preview.backup.createdAt).toLocaleString()}.</CfgComment>
              {preview.summary.map((item) => <CfgComment key={item}>{item}</CfgComment>)}
              {preview.warnings.map((item) => <CfgComment key={item}>{item}</CfgComment>)}
              <details><summary>Inspect settings and definitions</summary><CfgRow name="backup_contents"><CfgBlock value={JSON.stringify(preview.backup, null, 2)} readOnly rows={10} /></CfgRow></details>
              <CfgRow><button type="button" className="cfg-act" onClick={() => void run(async () => {
                await applySettingsImport(preview);
                setPreview(null);
                setBlob("");
                setPassphrase("");
                report("Backup merged. Existing items were kept; restart Husk to refresh every open window.");
              })}>[ Confirm & merge settings ]</button></CfgRow>
            </section>}
          </>
        )}
      </fieldset>
      {busy && <p role="status">Working on your encrypted backup…</p>}
      {feedback && <p role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    </ConfigEditor>
  );
}
