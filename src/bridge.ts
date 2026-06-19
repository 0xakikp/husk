// Terminal → GUI bridge. The injected shell scripts expose a `husk` command
// that emits OSC 777 (`husk;<verb>;<args>`); the active terminal parses it and
// dispatches here, and App registers a handler that drives the editor / preview
// / notifications / diff.
//
// IMPORTANT: The `husk` command is a shell FUNCTION injected by Husk into
// locally-spawned terminals (bash/zsh/fish). It does NOT exist on remote hosts
// accessed via SSH, docker exec, kubectl exec, etc. — unless you manually add
// the function to the remote shell's rc file (e.g. ~/.bashrc).
//
// For file transfers to remote hosts you don't own, use scp/rsync or Husk's
// SFTP panel instead. The `husk cp` bridge is designed for hosts where SSH/SFTP
// is unavailable (serial consoles, containers without SSH, bastion-jumped
// hosts, etc.) — any connection with a PTY.

export type BridgeCommand =
  | { kind: "open"; path: string }
  | { kind: "preview"; path: string }
  | { kind: "notify"; message: string }
  | { kind: "diff"; left: string; right: string }
  | { kind: "cp"; direction: "pull" | "push"; source: string; dest: string };

let handler: ((cmd: BridgeCommand) => void) | null = null;

export function setBridgeHandler(fn: ((cmd: BridgeCommand) => void) | null): void {
  handler = fn;
}

export function dispatchBridge(cmd: BridgeCommand): void {
  handler?.(cmd);
}

/** Parse an OSC 777 payload (`husk;<verb>;<args>`) into a command. */
export function parseBridgeOsc(data: string): BridgeCommand | null {
  if (!data.startsWith("husk;")) return null;
  const payload = data.slice("husk;".length);
  const semi = payload.indexOf(";");
  const verb = semi < 0 ? payload : payload.slice(0, semi);
  const rest = semi < 0 ? "" : payload.slice(semi + 1);
  switch (verb) {
    case "open":
      return rest ? { kind: "open", path: rest } : null;
    case "preview":
      return rest ? { kind: "preview", path: rest } : null;
    case "notify":
      return rest ? { kind: "notify", message: rest } : null;
    case "diff": {
      const parts = rest.split(";");
      if (parts.length < 3) return null;
      return { kind: "diff", left: parts[0], right: parts.slice(1).join(";") };
    }
    case "cp": {
      const parts = rest.split(";");
      if (parts.length < 4) return null;
      const direction = parts[0] as "pull" | "push";
      if (direction !== "pull" && direction !== "push") return null;
      return { kind: "cp", direction, source: parts[1], dest: parts.slice(2).join(";") };
    }
    default:
      return null;
  }
}
