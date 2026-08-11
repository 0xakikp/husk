import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";

import { clearSensitiveOutput, useSensitiveOutput } from "./sensitiveOutputStore";

/** A local privacy reminder. It stores scanner reasons, not the matched output. */
export function SensitiveOutputStrip({ leafId }: { leafId: number | null }) {
  const record = useSensitiveOutput(leafId);
  if (!record || leafId == null) return null;
  const details = record.reasons.join(", ");

  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-2.5 font-mono text-[10.5px]">
      <span className="size-1.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.5)]" />
      <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-amber-300">sensitive output</span>
      <span className="min-w-0 truncate text-muted-foreground" title={details}>· not sent to AI automatically</span>
      <div className="min-w-1 flex-1" />
      <button
        type="button"
        onClick={() => clearSensitiveOutput(leafId)}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-amber-300/90 transition-colors hover:bg-amber-400/10 hover:text-amber-200"
        title={`Matched: ${details}. Dismiss this local warning.`}
      >
        review later
      </button>
      <button
        type="button"
        onClick={() => clearSensitiveOutput(leafId)}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted/45 hover:text-foreground"
        title="Dismiss sensitive-output warning"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={1.75} />
      </button>
    </div>
  );
}
