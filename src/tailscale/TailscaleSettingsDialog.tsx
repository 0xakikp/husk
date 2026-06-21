import { useState, useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <Modal title="Tailscale Settings" onClose={onClose} className="max-w-md">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tailnet-name" className="text-sm font-medium">
            Tailnet Name
          </Label>
          <Input
            id="tailnet-name"
            value={tailnet}
            onChange={(e) => setTailnet(e.target.value)}
            placeholder="your-tailnet.ts.net or your-tailnet"
            className="bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-500/50 focus:border-blue-500 transition-all"
          />
          <p className="text-xs text-muted-foreground">
            Your tailnet name (e.g., "example.ts.net" or just "example")
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="api-key" className="text-sm font-medium">
            API Key
          </Label>
          <Input
            id="api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="tskey-api-..."
            className="bg-slate-50 dark:bg-neutral-900 border border-slate-300 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:focus:ring-blue-500/50 focus:border-blue-500 transition-all"
          />
          <p className="text-xs text-muted-foreground">
            Generate at{" "}
            <a
              href="https://login.tailscale.com/admin/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Tailscale admin console
            </a>
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-200 dark:border-white/10">
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testing || !apiKey || !tailnet}
          className="bg-transparent border border-slate-300 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white"
        >
          <HugeiconsIcon icon={CheckmarkCircle01Icon} size={14} className="mr-1.5" />
          {testing ? "Testing..." : "Test"}
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || !apiKey || !tailnet}
          className="bg-blue-600 hover:bg-blue-500 text-white border-0"
        >
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} className="mr-1.5" />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </Modal>
  );
}
