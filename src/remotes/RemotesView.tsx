import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { runInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";
import { shq } from "../lib/shellQuote";

async function readSshHosts(): Promise<string[]> {
  try {
    const home = await invoke<string>("home_dir");
    const content = await invoke<string>("read_file", { path: `${home}/.ssh/config` }).catch(
      () => "",
    );
    const hosts: string[] = [];
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*Host\s+(.+)$/i);
      if (m) {
        for (const h of m[1].split(/\s+/)) {
          if (h && !h.includes("*")) hosts.push(h);
        }
      }
    }
    return [...new Set(hosts)];
  } catch {
    return [];
  }
}

export function RemotesView({ onClose }: { onClose: () => void }) {
  const [hosts, setHosts] = useState<string[] | "loading">("loading");

  useEffect(() => {
    void readSshHosts().then(setHosts);
  }, []);

  const connect = (h: string) => {
    if (runInActiveTerminal(`ssh ${shq(h)}`)) {
      toast({ title: `ssh ${h}`, variant: "info" });
      onClose();
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Remotes" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Remotes (SSH)</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {hosts === "loading" ? (
            <p className="rb-empty">Loading…</p>
          ) : hosts.length === 0 ? (
            <p className="rb-empty">No hosts found in ~/.ssh/config.</p>
          ) : (
            <div className="rb-list">
              {hosts.map((h) => (
                <div key={h} className="rb-item">
                  <div className="rb-meta">
                    <span className="rb-name">{h}</span>
                  </div>
                  <button type="button" className="rb-run" title="SSH connect" onClick={() => connect(h)}>
                    ▶
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
