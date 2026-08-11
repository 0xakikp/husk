import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { runInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";
import { Modal } from "../components/Modal";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Database01Icon,
  Refresh01Icon,
  PlayIcon,
  ArrowLeft01Icon,
} from "@hugeicons/core-free-icons";

type ShellOutput = { exit_code: number | null };

async function checkTerraform(): Promise<boolean> {
  try {
    const o = await invoke<ShellOutput>("shell_run_command", {
      program: "terraform",
      args: ["version"],
      cwd: null,
      timeout_secs: 10,
    });
    return o.exit_code === 0;
  } catch {
    return false;
  }
}

const ACTIONS = [
  { id: "init", label: "Init", cmd: "terraform init" },
  { id: "validate", label: "Validate", cmd: "terraform validate" },
  { id: "plan", label: "Plan", cmd: "terraform plan" },
  { id: "apply", label: "Apply", cmd: "terraform apply" },
  { id: "destroy", label: "Destroy", cmd: "terraform destroy" },
];

export function TerraformView({
  onClose,
  onBack,
  inline,
}: {
  onClose?: () => void;
  /** Present when this built-in panel was opened from Plugins. */
  onBack?: () => void;
  inline?: boolean;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    void checkTerraform().then(setAvailable);
  }, []);

  const run = (cmd: string) => {
    if (runInActiveTerminal(cmd)) {
      toast({ title: `Running: ${cmd}`, variant: "info" });
      onClose?.();
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  const headerActions = (
    <button
      type="button"
      aria-label="Refresh"
      title="Refresh"
      onClick={() => void checkTerraform().then(setAvailable)}
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={1.5} />
    </button>
  );

  const leadingAction = onBack ? (
    <button
      type="button"
      aria-label="Back to plugins"
      title="Back to plugins"
      onClick={onBack}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
    >
      <HugeiconsIcon icon={ArrowLeft01Icon} size={13} strokeWidth={2} />
    </button>
  ) : undefined;

  return (
    <Modal title="Terraform" onClose={onClose} inline={inline} leadingAction={leadingAction} headerActions={headerActions}>
      {available === false ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={Database01Icon} size={20} className="text-primary" />
          </div>
          <p className="text-[12px] font-medium text-foreground">Terraform not found</p>
          <p className="max-w-[180px] text-[11px] text-muted-foreground">
            Install Terraform to use the IaC integration.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[11px] text-muted-foreground">
            Actions run in the active terminal's current directory.
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
      )}
    </Modal>
  );
}
