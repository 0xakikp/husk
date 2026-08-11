import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Copy01Icon, RepeatIcon, SparklesIcon } from "@hugeicons/core-free-icons";

import { cn } from "../lib/utils";
import {
  FAILURE_KIND_LABEL,
  clearFailure,
  expandFailure,
  useFailure,
  type FailureRecord,
} from "./failureStore";
import {
  runInActiveTerminal,
  getActiveTerminalDraft,
  setPendingRunAttachment,
} from "../ai/terminalContext";
import { openComposer } from "../ai/bubbleStore";
import { toast } from "../toast";

function commandLabel(command: string): string {
  const compact = command.trim().replace(/\s+/g, " ");
  if (!compact) return "command";
  return compact.length > 42 ? `${compact.slice(0, 41)}…` : compact;
}

/** The small, focused error explainer needs only this failure's evidence. */
export type FailureExplainRequest = Pick<
  FailureRecord,
  "command" | "output" | "exitCode" | "sensitive"
>;

/**
 * The Command Failure Assistant strip. Sits between a terminal pane and the
 * bottom status bar, belongs to exactly one pane, and appears only after a
 * completed command exited non-zero. Never a modal, never a notification.
 */
export function FailureStrip({
  leafId,
  onExplain,
}: {
  leafId: number | null;
  /** Opens the focused error explainer rather than a general-purpose chat. */
  onExplain?: (request: FailureExplainRequest) => void;
}) {
  const entry = useFailure(leafId);
  if (!entry || leafId == null) return null;
  const { record, collapsed } = entry;
  const kindLabel = FAILURE_KIND_LABEL[record.kind];

  const attachAndOpen = (prompt?: string) => {
    setPendingRunAttachment({
      command: record.command,
      output: record.output,
      exitCode: record.exitCode,
      at: record.at,
    });
    openComposer(prompt);
    /* Every open composer attaches a copy; the slot has done its job once
       they've had a render cycle to read it. */
    window.setTimeout(() => setPendingRunAttachment(null), 800);
  };

  const explain = () => {
    if (onExplain) {
      onExplain({
        command: record.command,
        output: record.output,
        exitCode: record.exitCode,
        sensitive: record.sensitive,
      });
      return;
    }
    /* Compatibility fallback for a host that has not wired the focused
       explainer yet. The normal Husk workspace always takes the path above. */
    attachAndOpen("Explain why this command failed and suggest the smallest fix.");
  };

  const copyError = () => {
    const text = `$ ${record.command}\n${record.output}`.trim();
    void writeText(text)
      .then(() => toast({ title: "Error copied", variant: "info" }))
      .catch(() => toast({ title: "Could not copy", variant: "error" }));
  };

  /* Retry is always an explicit click. Husk never retries on its own. */
  const retry = () => {
    if (!record.command.trim()) return;
    if (getActiveTerminalDraft()) {
      toast({
        title: "Terminal input is waiting",
        message: "Clear or submit the text at the prompt before retrying this command.",
        variant: "warning",
      });
      return;
    }
    clearFailure(leafId);
    if (!runInActiveTerminal(record.command)) {
      toast({ title: "Could not retry command", message: "Open and focus a terminal, then try again.", variant: "error" });
    }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => expandFailure(leafId)}
        title={`${commandLabel(record.command)} failed — expand failure actions`}
        className="inline-flex h-5 shrink-0 items-center gap-1.5 self-start rounded-md border border-red-400/25 bg-background/50 px-2 font-mono text-[10px] text-red-400/90 transition-colors hover:bg-red-400/10"
      >
        <span className="size-1.5 rounded-full bg-red-400 shadow-[0_0_5px_rgba(248,113,113,0.55)]" />
        Last command failed
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-lg border border-red-400/25 bg-background/50 px-2.5 font-mono text-[10.5px]",
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-red-400 shadow-[0_0_5px_rgba(248,113,113,0.55)]" />
      <span className="shrink-0 text-red-400">✕</span>
      <span className="min-w-0 truncate text-foreground/90" title={record.command}>
        {commandLabel(record.command)}
      </span>
      <span className="shrink-0 text-muted-foreground/75">exited {record.exitCode}</span>
      {kindLabel && (
        <span className="shrink-0 rounded border border-amber-400/30 px-1 py-px text-[9px] text-amber-400/90">
          {kindLabel}
        </span>
      )}
      {record.sensitive && (
        <span
          className="shrink-0 rounded border border-amber-400/30 px-1 py-px text-[9px] text-amber-400/90"
          title="The output looks like it may contain credentials — review before sending it to AI"
        >
          ⚠ secrets?
        </span>
      )}

      <div className="min-w-2 flex-1" />

      <button
        type="button"
        onClick={explain}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-primary/90 transition-colors hover:bg-muted/45 hover:text-primary"
        title="Explain this failure here — it does not open a chat"
      >
        <HugeiconsIcon icon={SparklesIcon} size={10} strokeWidth={1.75} />
        Explain
      </button>
      <button
        type="button"
        onClick={() => attachAndOpen("Help me fix this command failure. What went wrong, and what is the smallest safe next step?")}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
        title="Open the terminal composer with this failure attached and a ready-to-send recovery question"
      >
        Ask AI
      </button>
      <button
        type="button"
        onClick={copyError}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
      >
        <HugeiconsIcon icon={Copy01Icon} size={10} strokeWidth={1.75} />
        Copy error
      </button>
      {record.command.trim() && (
        <button
          type="button"
          onClick={retry}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
          title={`Run again: ${record.command}`}
        >
          <HugeiconsIcon icon={RepeatIcon} size={10} strokeWidth={1.75} />
          Retry
        </button>
      )}
      <button
        type="button"
        onClick={() => clearFailure(leafId)}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted/45 hover:text-foreground"
        title="Dismiss"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={1.75} />
      </button>
    </div>
  );
}
