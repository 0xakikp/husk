import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { runInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";
import { shq } from "../lib/shellQuote";
import { Modal } from "../components/Modal";

type ShellOutput = { stdout: string; stderr: string; exit_code: number | null };

async function listProfiles(): Promise<string[] | null> {
  try {
    const o = await invoke<ShellOutput>("shell_run_command", {
      command: "aws configure list-profiles",
      cwd: null,
      timeout_secs: 10,
    });
    if (o.exit_code !== 0) return null;
    return o.stdout
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function AwsProfilesDialog({ onClose }: { onClose: () => void }) {
  const [profiles, setProfiles] = useState<string[] | null | "loading">("loading");

  useEffect(() => {
    void listProfiles().then(setProfiles);
  }, []);

  const use = (p: string) => {
    if (runInActiveTerminal(`export AWS_PROFILE=${shq(p)}`)) {
      toast({ title: `AWS_PROFILE=${p}`, variant: "success" });
      onClose();
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  return (
    <Modal title="AWS profiles" onClose={onClose}>
          {profiles === "loading" ? (
            <p className="rb-empty">Loading…</p>
          ) : profiles === null ? (
            <p className="rb-empty">AWS CLI isn't on your PATH.</p>
          ) : profiles.length === 0 ? (
            <p className="rb-empty">No profiles found in ~/.aws.</p>
          ) : (
            <div className="rb-list">
              {profiles.map((p) => (
                <div key={p} className="rb-item">
                  <div className="rb-meta">
                    <span className="rb-name">{p}</span>
                  </div>
                  <button
                    type="button"
                    className="rb-run"
                    title="Use (export AWS_PROFILE in terminal)"
                    onClick={() => use(p)}
                  >
                    ▶
                  </button>
                </div>
              ))}
            </div>
          )}
    </Modal>
  );
}
