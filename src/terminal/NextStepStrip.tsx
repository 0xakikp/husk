import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Copy01Icon, SparklesIcon } from "@hugeicons/core-free-icons";

import { suggestNextCommand } from "../ai/assist";
import { openComposer } from "../ai/bubbleStore";
import { setPendingRunAttachment, typeInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";
import { dismissNextSteps, useNextSteps } from "./nextSteps";
import { useWorkflowSuggestion } from "../workflows/suggestions";
import { useWorkspaceRoot } from "../workspace/store";

function commandLabel(command: string): string {
  const compact = command.trim().replace(/\s+/g, " ");
  return compact.length > 34 ? `${compact.slice(0, 33)}…` : compact || "command";
}

/**
 * A small post-success guidance strip. Local suggestions are deterministic and
 * stage-only; the AI option is explicit and never receives terminal output
 * until the user asks for it.
 */
export function NextStepStrip({
  leafId,
  aiEnabled,
}: {
  leafId: number | null;
  aiEnabled: boolean;
}) {
  const entry = useNextSteps(leafId);
  const workflowSuggestion = useWorkflowSuggestion(leafId);
  const workspaceRoot = useWorkspaceRoot();
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [noSuggestion, setNoSuggestion] = useState(false);

  if (
    !entry
    || leafId == null
    || entry.collapsed
    || workflowSuggestion?.workspaceRoot === workspaceRoot
  ) return null;
  const { record } = entry;
  /* Local guidance stays useful with AI disabled, but do not render a blank
     strip after a generic command when neither kind of action is available. */
  if (record.local.length === 0 && !aiEnabled) return null;

  const stage = (command: string) => {
    if (!typeInActiveTerminal(command)) {
      toast({ title: "No active terminal", message: "Focus a terminal to stage this command.", variant: "error" });
      return;
    }
    toast({ title: "Next command staged", message: "Review it in the terminal, then press Enter to run.", variant: "info" });
  };

  const copy = (command: string) => {
    void writeText(command)
      .then(() => toast({ title: "Command copied", variant: "info" }))
      .catch(() => toast({ title: "Could not copy", variant: "error" }));
  };

  const askAi = () => {
    setPendingRunAttachment({
      command: record.command,
      output: record.output,
      exitCode: record.exitCode,
      at: record.at,
    });
    openComposer("What is the safest next step after this completed command?");
    window.setTimeout(() => setPendingRunAttachment(null), 800);
  };

  const suggest = async () => {
    if (busy) return;
    if (record.sensitive) {
      toast({
        title: "Output may contain secrets",
        message: "Husk did not send it for a next-step suggestion. Use Ask AI to review the attachment first.",
        variant: "info",
      });
      return;
    }
    setBusy(true);
    setSuggestion(null);
    setNoSuggestion(false);
    try {
      const next = await suggestNextCommand(record.command, record.output, record.cwd);
      if (next) setSuggestion(next);
      else setNoSuggestion(true);
    } catch (error) {
      toast({
        title: "Could not suggest a next command",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 overflow-x-auto rounded-lg border border-primary/20 bg-background/50 px-2.5 font-mono text-[10.5px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span className="size-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_5px_hsl(var(--primary)/0.55)]" />
      <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-primary/90">next</span>
      <span className="min-w-0 shrink truncate text-muted-foreground" title={record.command}>
        after {commandLabel(record.command)}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        {suggestion ? (
          <>
            <span className="max-w-[220px] truncate rounded bg-primary/10 px-1.5 py-0.5 text-primary" title={suggestion}>
              AI: {suggestion}
            </span>
            <button
              type="button"
              onClick={() => stage(suggestion)}
              title="Stage this command in the terminal; it will not run until you press Enter"
              className="rounded-md px-1.5 py-0.5 text-primary/90 transition-colors hover:bg-muted/45 hover:text-primary"
            >
              stage
            </button>
            <button
              type="button"
              onClick={() => copy(suggestion)}
              title="Copy command"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
            >
              <HugeiconsIcon icon={Copy01Icon} size={10} strokeWidth={1.75} />
              copy
            </button>
          </>
        ) : (
          <>
            {record.local.map((step) => (
              <button
                key={step.id}
                type="button"
                onClick={() => stage(step.command)}
                title={`Stage: ${step.command}`}
                className="rounded-md px-1.5 py-0.5 text-primary/90 transition-colors hover:bg-muted/45 hover:text-primary"
              >
                {step.label}
              </button>
            ))}
            {noSuggestion ? <span className="text-muted-foreground">no reliable AI next step</span> : null}
            {aiEnabled ? (
              <button
                type="button"
                onClick={() => void suggest()}
                disabled={busy}
                title="Ask the selected model for one safe next command; it is staged, never run automatically"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground disabled:opacity-60"
              >
                <HugeiconsIcon icon={SparklesIcon} size={10} strokeWidth={1.75} className={busy ? "animate-pulse" : undefined} />
                {busy ? "thinking…" : "suggest next"}
              </button>
            ) : null}
          </>
        )}
        {aiEnabled ? (
          <button
            type="button"
            onClick={askAi}
            title="Open Husk chat with this command and its output attached"
            className="rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
          >
            Ask AI
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => dismissNextSteps(leafId)}
        className="ml-auto shrink-0 rounded-md p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted/45 hover:text-foreground"
        title="Dismiss next steps"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={1.75} />
      </button>
    </div>
  );
}
