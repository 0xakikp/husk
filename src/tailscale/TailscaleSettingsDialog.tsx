import { useState, useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  CloudIcon,
  CheckmarkCircle01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { getPrefs, setPrefs, testConnection } from "./api";
import { toast } from "@/toast";

export function TailscaleSettingsDialog({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [tailnet, setTailnet] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPrefs().then((prefs) => {
      if (prefs) {
        setApiKey(prefs.api_key);
        setTailnet(prefs.tailnet);
      }
    });
  }, []);

  const handleTest = async () => {
    if (!apiKey || !tailnet) {
      toast({ title: "Please fill in both fields", variant: "error" });
      return;
      }
      setTesting(true);
      try {
      await setPrefs({ api_key: apiKey, tailnet: tailnet });
      const ok = await testConnection();
      if (ok) {
      toast({ title: "Connection successful!", variant: "success" });
      } else {
      toast({ title: "Connection failed. Check your API key and tailnet name.", variant: "error" });
      }
      } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Connection failed", variant: "error" });
      } finally {
      setTesting(false);
      }
      };

      const handleSave = async () => {
      if (!apiKey || !tailnet) {
      toast({ title: "Please fill in both fields", variant: "error" });
      return;
      }
      setSaving(true);
      try {
      await setPrefs({ api_key: apiKey, tailnet: tailnet });
      toast({ title: "Tailscale settings saved", variant: "success" });
      onClose();
      } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to save", variant: "error" });
      } finally {
      setSaving(false);
      }
      };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="flex w-[400px] flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-[0_24px_70px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={CloudIcon} size={16} strokeWidth={1.75} className="text-primary" />
            <span className="text-sm font-medium">Tailscale Settings</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Tailnet Name</label>
            <input
              value={tailnet}
              onChange={(e) => setTailnet(e.target.value)}
              placeholder="your-tailnet.ts.net or your-tailnet"
              className="h-8 rounded-md border border-muted-foreground/25 bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-primary"
            />
            <p className="text-[10px] text-muted-foreground">
              Your tailnet name (e.g., "akikp.ts.net" or just "akikp")
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="tskey-api-..."
              className="h-8 rounded-md border border-muted-foreground/25 bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-primary"
            />
            <p className="text-[10px] text-muted-foreground">
              Generate at <a href="https://login.tailscale.com/admin/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Tailscale admin console</a>
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !apiKey || !tailnet}
            className="flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50"
          >
            <HugeiconsIcon icon={CheckmarkCircle01Icon} size={12} strokeWidth={1.75} />
            {testing ? "Testing..." : "Test"}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !apiKey || !tailnet}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={1.75} />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
