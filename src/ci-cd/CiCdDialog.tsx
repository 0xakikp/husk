import { runInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";
import { Modal } from "../components/Modal";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, PlayIcon } from "@hugeicons/core-free-icons";

const ACTIONS = [
  { id: "runs", label: "List workflow runs", cmd: "gh run list" },
  { id: "watch", label: "Watch latest run", cmd: "gh run watch" },
  { id: "workflows", label: "List workflows", cmd: "gh workflow list" },
  { id: "view", label: "View latest run", cmd: "gh run view" },
];

export function CiCdDialog({
  onClose,
  onBack,
  inline,
}: {
  onClose?: () => void;
  /** Present when this built-in panel was opened from Plugins. */
  onBack?: () => void;
  inline?: boolean;
}) {
  const run = (cmd: string) => {
    if (runInActiveTerminal(cmd)) {
      toast({ title: `Running: ${cmd}`, variant: "info" });
      onClose?.();
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  return (
    <Modal
      title="CI / CD"
      onClose={onClose}
      inline={inline}
      leadingAction={onBack ? (
        <button
          type="button"
          aria-label="Back to plugins"
          title="Back to plugins"
          onClick={onBack}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={13} strokeWidth={2} />
        </button>
      ) : undefined}
    >
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-muted-foreground">
          GitHub Actions via <code>gh</code> in the active terminal's repository.
        </p>
        <div className="flex flex-col gap-1">
          {ACTIONS.map((a) => (
            <div
              key={a.id}
              className="group flex items-center gap-2 rounded-md border border-border/20 bg-card/20 px-2 py-1.5 transition-colors hover:border-border/40"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[11.5px] font-medium text-foreground">
                  {a.label}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">{a.cmd}</span>
              </div>
              <button
                type="button"
                onClick={() => run(a.cmd)}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                title="Run"
              >
                <HugeiconsIcon icon={PlayIcon} size={11} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
