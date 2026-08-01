import { useState } from "react";
import { toast } from "../../toast";
import { exportSettings, importSettings } from "../cloudSync";
import {
  ConfigEditor,
  CfgArt,
  CfgAct,
  CfgBlank,
  CfgBlock,
  CfgComment,
  CfgEnum,
  CfgRow,
  CfgSection,
  CfgText,
} from "../config/controls";
import { BANNERS } from "../config/banners";

export function SyncFile() {
  const [mode, setMode] = useState<"export" | "import">("export");
  const [passphrase, setPassphrase] = useState("");
  const [blob, setBlob] = useState("");

  const handleExport = async () => {
    if (!passphrase.trim()) {
      toast({ title: "Passphrase required", variant: "error" });
      return;
    }
    try {
      const encrypted = await exportSettings(passphrase.trim());
      setBlob(encrypted);
      toast({ title: "Settings exported to clipboard", variant: "success" });
    } catch {
      toast({ title: "Export failed", variant: "error" });
    }
  };

  const handleImport = async () => {
    if (!passphrase.trim() || !blob.trim()) {
      toast({ title: "Passphrase and blob required", variant: "error" });
      return;
    }
    try {
      await importSettings(blob.trim(), passphrase.trim());
      toast({ title: "Settings imported. Reloading…", variant: "success" });
      setTimeout(() => window.location.reload(), 800);
    } catch {
      toast({ title: "Import failed — wrong passphrase or corrupted blob", variant: "error" });
    }
  };

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.sync} />
      <CfgBlank />
      <CfgComment>data is encrypted locally with your passphrase —</CfgComment>
      <CfgComment>nothing leaves your device unencrypted.</CfgComment>
      <CfgBlank />

      <CfgSection name="sync" />
      <CfgRow name="mode" comment="Where synced settings are read from and written to.">
        <CfgEnum
          value={mode}
          onChange={setMode}
          options={[
            { value: "export", label: "export" },
            { value: "import", label: "import" },
          ]}
        />
      </CfgRow>
      <CfgRow name="passphrase" comment="Min 8 characters.">
        <CfgText secret value={passphrase} onChange={setPassphrase} placeholder="passphrase" widthCh={20} />
      </CfgRow>

      {mode === "export" ? (
        <>
          <CfgRow>
            <CfgAct onClick={() => void handleExport()}>generate encrypted blob</CfgAct>
          </CfgRow>
          {blob ? (
            <>
              <CfgBlank />
              <CfgComment>copy this blob to the other device:</CfgComment>
              <CfgRow>
                <CfgBlock
                  value={blob}
                  readOnly
                  rows={6}
                  onClick={() => {
                    void navigator.clipboard.writeText(blob);
                    toast({ title: "Copied to clipboard", variant: "success" });
                  }}
                />
              </CfgRow>
            </>
          ) : null}
        </>
      ) : (
        <>
          <CfgRow name="blob" comment="Paste the blob from the other device.">
            <CfgBlock value={blob} onChange={setBlob} rows={6} placeholder="husk-sync:…" />
          </CfgRow>
          <CfgRow>
            <CfgAct onClick={() => void handleImport()}>import & apply</CfgAct>
          </CfgRow>
        </>
      )}
    </ConfigEditor>
  );
}
