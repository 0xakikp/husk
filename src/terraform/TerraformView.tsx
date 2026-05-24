import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { runInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";

type ShellOutput = { exit_code: number | null };

async function checkTerraform(): Promise<boolean> {
  try {
    const o = await invoke<ShellOutput>("shell_run_command", {
      command: "terraform version",
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

export function TerraformView({ onClose }: { onClose: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    void checkTerraform().then(setAvailable);
  }, []);

  const run = (cmd: string) => {
    if (runInActiveTerminal(cmd)) {
      toast({ title: `Running: ${cmd}`, variant: "info" });
      onClose();
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Terraform" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Terraform</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {available === false ? (
            <p className="rb-empty">terraform isn't on your PATH.</p>
          ) : (
            <>
              <p className="rb-empty" style={{ margin: 0 }}>
                Actions run in the active terminal's current directory.
              </p>
              <div className="rb-list">
                {ACTIONS.map((a) => (
                  <div key={a.id} className="rb-item">
                    <div className="rb-meta">
                      <span className="rb-name">{a.label}</span>
                      <span className="rb-steps">{a.cmd}</span>
                    </div>
                    <button type="button" className="rb-run" title="Run" onClick={() => run(a.cmd)}>
                      ▶
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
