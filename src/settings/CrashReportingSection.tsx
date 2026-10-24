import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setSentryEnabled, useSentryEnabled } from "./crashReporting";
import { toast } from "../toast";

export { getSentryEnabled, setSentryEnabled } from "./crashReporting";

export function CrashReportingSection() {
  const enabled = useSentryEnabled();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Label>Crash Reporting</Label>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">
            Send error messages, stack traces, and app/version details. Error text can contain diagnostic information. Changes take effect immediately.
          </span>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(value) => {
            if (!setSentryEnabled(value)) toast({ variant: "error", title: "Privacy choice could not be saved", message: "Reporting is off in this window. Retry to save the choice for other windows and future launches." });
          }}
          aria-label="Toggle crash reporting"
        />
      </div>
    </section>
  );
}
