import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "../toast";
import { CloudUploadIcon, Download02Icon, Upload02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { exportSettings, importSettings } from "./cloudSync";

export function CloudSyncSection() {
  const [mode, setMode] = useState<"export" | "import">("export");
  const [passphrase, setPassphrase] = useState("");
  const [blob, setBlob] = useState("");

  const handleExport = () => {
    if (!passphrase.trim()) {
      toast({ title: "Passphrase required", variant: "error" });
      return;
    }
    try {
      const encrypted = exportSettings(passphrase.trim());
      setBlob(encrypted);
      toast({ title: "Settings exported to clipboard", variant: "success" });
    } catch (e) {
      toast({ title: "Export failed", variant: "error" });
    }
  };

  const handleImport = () => {
    if (!passphrase.trim() || !blob.trim()) {
      toast({ title: "Passphrase and blob required", variant: "error" });
      return;
    }
    try {
      importSettings(blob.trim(), passphrase.trim());
      toast({ title: "Settings imported. Reloading…", variant: "success" });
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      toast({ title: "Import failed — wrong passphrase or corrupted blob", variant: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={CloudUploadIcon} size={16} className="text-primary" />
        <h2 className="text-sm font-semibold">Cloud Sync</h2>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Export an encrypted blob of all your settings (SSH connections, bookmarks, preferences) and paste it on another device to sync.
      </p>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === "export" ? "default" : "outline"}
          className="text-[11px] h-7 gap-1"
          onClick={() => setMode("export")}
        >
          <HugeiconsIcon icon={Upload02Icon} size={12} />
          Export
        </Button>
        <Button
          size="sm"
          variant={mode === "import" ? "default" : "outline"}
          className="text-[11px] h-7 gap-1"
          onClick={() => setMode("import")}
        >
          <HugeiconsIcon icon={Download02Icon} size={12} />
          Import
        </Button>
      </div>

      <div className="space-y-3">
        <div>
          <Label className="text-[11px]">Passphrase</Label>
          <Input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Min 8 characters"
            className="h-8 text-[11px]"
          />
        </div>

        {mode === "export" ? (
          <>
            <Button size="sm" className="text-[11px] h-7" onClick={handleExport}>
              Generate Encrypted Blob
            </Button>
            {blob && (
              <div>
                <Label className="text-[11px]">Encrypted Blob (copy this)</Label>
                <Textarea
                  value={blob}
                  readOnly
                  className="text-[10px] font-mono h-24"
                  onClick={(e) => {
                    (e.target as HTMLTextAreaElement).select();
                    navigator.clipboard.writeText(blob);
                    toast({ title: "Copied to clipboard", variant: "success" });
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <div>
              <Label className="text-[11px]">Encrypted Blob (paste here)</Label>
              <Textarea
                value={blob}
                onChange={(e) => setBlob(e.target.value)}
                placeholder="Paste the encrypted blob from another device..."
                className="text-[10px] font-mono h-24"
              />
            </div>
            <Button size="sm" className="text-[11px] h-7" onClick={handleImport}>
              Import &amp; Apply
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
