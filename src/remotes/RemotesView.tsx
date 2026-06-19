import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { runInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";
import { shq } from "../lib/shellQuote";
import { Modal } from "../components/Modal";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DatabaseIcon,
  Refresh01Icon,
  PlayIcon,
  FolderUploadIcon,
} from "@hugeicons/core-free-icons";
import { setActiveSshHost } from "../remote/store";

async function readSshHosts(): Promise<string[]> {
  try {
    const home = await invoke<string>("home_dir");
    const content = await invoke<string>("read_file", {
      path: `${home}/.ssh/config`,
    }).catch(() => "");
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

export function RemotesView({
  onClose,
  inline,
  onSftp,
}: {
  onClose?: () => void;
  inline?: boolean;
  onSftp?: (host: string) => void;
}) {
  const [hosts, setHosts] = useState<string[] | "loading">("loading");

  const load = () => void readSshHosts().then(setHosts);

  useEffect(() => {
    load();
  }, []);

  const connect = (h: string) => {
    if (runInActiveTerminal(`ssh ${shq(h)}`)) {
      toast({ title: `ssh ${h}`, variant: "info" });
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
      onClick={load}
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={1.5} />
    </button>
  );

  return (
    <Modal title="Remotes" onClose={onClose} inline={inline} headerActions={headerActions}>
      {hosts === "loading" ? (
        <div className="py-8 text-center text-[11px] text-muted-foreground">
          Loading…
        </div>
      ) : hosts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={DatabaseIcon} size={20} className="text-primary" />
          </div>
          <p className="text-[12px] font-medium text-foreground">
            No SSH hosts found
          </p>
          <p className="max-w-[180px] text-[11px] text-muted-foreground">
            Add hosts to ~/.ssh/config to connect with one click.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {hosts.map((h) => (
            <div
              key={h}
              className="group flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/10"
            >
              <button
                type="button"
                onClick={() => connect(h)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <HugeiconsIcon
                  icon={DatabaseIcon}
                  size={14}
                  strokeWidth={1.75}
                  className="shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                  {h}
                </span>
              </button>
              <button
                type="button"
                title="SFTP"
                onClick={() => {
                  setActiveSshHost(h);
                  onSftp?.(h);
                }}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
              >
                <HugeiconsIcon icon={FolderUploadIcon} size={11} strokeWidth={2} />
              </button>
              <button
                type="button"
                title="Connect terminal"
                onClick={() => connect(h)}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
              >
                <HugeiconsIcon icon={PlayIcon} size={11} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
