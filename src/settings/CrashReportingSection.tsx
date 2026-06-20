import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useState, useEffect } from "react";

const STORAGE_KEY = "husk:sentry-enabled";

export function getSentryEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setSentryEnabled(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // ignore
  }
}

export function CrashReportingSection() {
  const [enabled, setEnabled] = useState(getSentryEnabled());

  useEffect(() => {
    setSentryEnabled(enabled);
  }, [enabled]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Label>Crash Reporting</Label>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            Automatically send error reports to help improve Husk. No personal data or commands are included.
          </span>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="Toggle crash reporting"
        />
      </div>
    </section>
  );
}
