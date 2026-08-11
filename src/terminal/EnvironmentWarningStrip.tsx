import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";

import { typeInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";
import { clearEnvironmentWarning, useEnvironmentWarning } from "./environmentWarnings";

function commandLabel(command: string): string {
  const compact = command.trim().replace(/\s+/g, " ");
  return compact.length > 38 ? `${compact.slice(0, 37)}…` : compact || "command";
}

/** A command-aware production warning. It never pretends to stop a command
 * already accepted by the shell; it names the target and offers a safe context
 * check that is staged for review. */
export function EnvironmentWarningStrip({ leafId }: { leafId: number | null }) {
  const record = useEnvironmentWarning(leafId);
  if (!record || leafId == null) return null;
  const primary = record.targets[0];
  if (!primary) return null;
  const label = `${primary.kind} / ${primary.value}`;

  const stageInspection = () => {
    if (!typeInActiveTerminal(primary.inspectCommand)) {
      toast({ title: "No active terminal", message: "Focus this terminal to stage the context check.", variant: "error" });
      return;
    }
    toast({ title: "Context check staged", message: "Review it in the terminal, then press Enter to run.", variant: "info" });
  };

  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-lg border border-amber-400/35 bg-amber-400/[0.07] px-2.5 font-mono text-[10.5px]">
      <span className="size-1.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.55)]" />
      <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-amber-300">environment</span>
      <span className="min-w-0 truncate text-foreground/90" title={label}>{label}</span>
      {record.targets.length > 1 ? <span className="shrink-0 text-amber-300/80">+{record.targets.length - 1}</span> : null}
      <span className="min-w-0 shrink truncate text-muted-foreground" title={record.command}>· {commandLabel(record.command)}</span>

      <div className="min-w-1 flex-1" />

      <button
        type="button"
        onClick={stageInspection}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-amber-300/90 transition-colors hover:bg-amber-400/10 hover:text-amber-200"
        title={`Stage: ${primary.inspectCommand}`}
      >
        verify context
      </button>
      <button
        type="button"
        onClick={() => clearEnvironmentWarning(leafId)}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted/45 hover:text-foreground"
        title="Acknowledge and dismiss environment warning"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={1.75} />
      </button>
    </div>
  );
}
