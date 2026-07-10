import { useState } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Download01Icon,
  Upload01Icon,
  CloudIcon,
  LockPasswordIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportSettings, importSettings, encryptData, decryptData } from "./sync";
import { toast } from "../toast";

export function CloudSyncDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [encryptedBlob, setEncryptedBlob] = useState("");
  const [mode, setMode] = useState<"export" | "import">("export");

  const handleExport = async () => {
    if (!passphrase.trim()) {
      toast({ title: "Passphrase required", variant: "error" });
      return;
    }
    try {
      const data = exportSettings();
      const encrypted = await encryptData(data, passphrase);
      setEncryptedBlob(encrypted);
      await navigator.clipboard.writeText(encrypted);
      toast({ title: "Exported & copied to clipboard", variant: "success" });
    } catch {
      toast({ title: "Export failed", variant: "error" });
    }
  };

  const handleImport = async () => {
    if (!passphrase.trim()) {
      toast({ title: "Passphrase required", variant: "error" });
      return;
    }
    if (!encryptedBlob.trim()) {
      toast({ title: "Paste encrypted data first", variant: "error" });
      return;
    }
    try {
      const data = await decryptData(encryptedBlob.trim(), passphrase);
      const result = importSettings(data);
      if (result.success) {
        toast({
          title: "Import successful",
          message: result.imported.join(", "),
          variant: "success",
        });
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast({
          title: "Import completed with errors",
          message: result.errors.join("; "),
          variant: "error",
        });
      }
    } catch (e) {
      toast({ title: "Decryption failed — wrong passphrase?", variant: "error" });
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal max-w-md" role="dialog" aria-label="Cloud Sync" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="flex items-center gap-2">
            <HugeiconsIcon icon={CloudIcon} size={14} />
            Cloud Sync
          </span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {/* Mode toggle */}
          <div className="flex rounded-md bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => setMode("export")}
              className={cn(
                "flex-1 rounded py-1 text-[11px] font-medium transition-colors",
                mode === "export" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <HugeiconsIcon icon={Upload01Icon} size={12} className="inline mr-1" />
              Export
            </button>
            <button
              type="button"
              onClick={() => setMode("import")}
              className={cn(
                "flex-1 rounded py-1 text-[11px] font-medium transition-colors",
                mode === "import" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <HugeiconsIcon icon={Download01Icon} size={12} className="inline mr-1" />
              Import
            </button>
          </div>

          {/* Passphrase */}
          <div>
            <Label className="text-[11px] flex items-center gap-1">
              <HugeiconsIcon icon={LockPasswordIcon} size={10} />
              Passphrase
            </Label>
            <Input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Min 8 characters"
              className="h-8 text-[12px] mt-1"
            />
            <p className="text-[9px] text-muted-foreground mt-1">
              Same passphrase needed for import. Not stored anywhere.
            </p>
          </div>

          {mode === "export" ? (
            <div className="flex flex-col gap-2">
              <Button size="sm" className="text-[11px] h-8" onClick={handleExport}>
                <HugeiconsIcon icon={Upload01Icon} size={12} className="mr-1" />
                Export & Copy
              </Button>
              {encryptedBlob && (
                <div className="flex flex-col gap-1">
                  <Label className="text-[10px]">Encrypted blob (save this):</Label>
                  <textarea
                    readOnly
                    value={encryptedBlob}
                    className="h-20 rounded-md border border-border/40 bg-muted/20 p-2 text-[9px] font-mono break-all [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div>
                <Label className="text-[10px]">Paste encrypted blob:</Label>
                <textarea
                  value={encryptedBlob}
                  onChange={(e) => setEncryptedBlob(e.target.value)}
                  placeholder="Paste the encrypted data here..."
                  className="h-20 w-full rounded-md border border-border/40 bg-muted/20 p-2 text-[9px] font-mono break-all [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                />
              </div>
              <Button size="sm" className="text-[11px] h-8" onClick={handleImport}>
                <HugeiconsIcon icon={Download01Icon} size={12} className="mr-1" />
                Import & Reload
              </Button>
            </div>
          )}

          <div className="rounded-md bg-muted/20 p-2 text-[9px] text-muted-foreground">
            <p className="font-semibold mb-1">What gets synced:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>SSH connections</li>
              <li>Bookmarks</li>
              <li>Settings (theme, font, etc.)</li>
              <li>SSH config</li>
            </ul>
            <p className="mt-2 text-[8px] opacity-60">
              No external service needed. Copy the encrypted blob to any device and import.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
