import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Copy01Icon } from "@hugeicons/core-free-icons";

import { toast } from "../toast";
import { clearPorts, usePorts } from "./portStore";

function compactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return value;
  }
}

/** A detected endpoint is a convenience, not a claimed health check. */
export function PortDetectedStrip({
  leafId,
  onOpenBrowser,
}: {
  leafId: number | null;
  onOpenBrowser: (url: string) => void;
}) {
  const record = usePorts(leafId);
  if (!record || leafId == null) return null;
  const primary = record.urls[0];
  if (!primary) return null;

  const copy = () => {
    void writeText(primary)
      .then(() => toast({ title: "Local URL copied", variant: "info" }))
      .catch(() => toast({ title: "Could not copy URL", variant: "error" }));
  };

  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-lg border border-sky-400/25 bg-background/50 px-2.5 font-mono text-[10.5px]">
      <span className="size-1.5 shrink-0 rounded-full bg-sky-400 shadow-[0_0_5px_rgba(56,189,248,0.5)]" />
      <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-sky-400">local server</span>
      <span className="min-w-0 truncate text-foreground/90" title={primary}>{compactUrl(primary)}</span>
      {record.urls.length > 1 ? <span className="shrink-0 text-muted-foreground/75">+{record.urls.length - 1}</span> : null}

      <div className="min-w-1 flex-1" />

      <button
        type="button"
        onClick={() => onOpenBrowser(primary)}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-sky-400/90 transition-colors hover:bg-sky-400/10 hover:text-sky-300"
        title={`Open ${primary} in Husk's browser`}
      >
        open
      </button>
      <button
        type="button"
        onClick={copy}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
        title="Copy local URL"
      >
        <HugeiconsIcon icon={Copy01Icon} size={10} strokeWidth={1.75} />
        copy
      </button>
      <button
        type="button"
        onClick={() => clearPorts(leafId)}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted/45 hover:text-foreground"
        title="Dismiss detected local server"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={1.75} />
      </button>
    </div>
  );
}
