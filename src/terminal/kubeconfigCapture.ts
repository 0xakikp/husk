import type { PromptReadiness } from "./promptDraft";

export const KUBECONFIG_OSC = 779;
export const MAX_TERMINAL_KUBECONFIG_BYTES = 8_192;
const PREFIX = "husk;kubeconfig;1;";

export type TerminalKubeconfigSnapshot =
  | { available: true; leafId: number; ptyId: number; cwd: string; kubeconfig: string | null; defaultKubeconfigPath: string | null; capturedAt: number }
  | { available: false; reason: string };

/** Only path metadata, never a general environment dump or kubeconfig contents. */
export function parseKubeconfigOsc(data: string): { kubeconfig: string | null; defaultKubeconfigPath: string | null } | null {
  if (!data.startsWith(PREFIX) || data.length > PREFIX.length + 8 + MAX_TERMINAL_KUBECONFIG_BYTES * 3) return null;
  const payload = data.slice(PREFIX.length);
  if (!payload.startsWith("value;") && !payload.startsWith("unset;")) return null;
  try {
    const kubeconfig = decodeURIComponent(payload.slice(6));
    if (/[\u0000-\u001f\u007f-\u009f]/.test(kubeconfig)
      || new TextEncoder().encode(kubeconfig).byteLength > MAX_TERMINAL_KUBECONFIG_BYTES) return null;
    if (!kubeconfig) return null;
    if (payload.startsWith("unset;")) {
      return kubeconfig.startsWith("/") ? { kubeconfig: null, defaultKubeconfigPath: kubeconfig } : null;
    }
    return { kubeconfig, defaultKubeconfigPath: null };
  } catch { return null; }
}

type Capture = { kubeconfig: string | null; defaultKubeconfigPath: string | null; capturedAt: number; generation: number; cwd: string };
export type KubeconfigCaptureScope = {
  leafId: number;
  ptyId: number | null;
  cwd: string;
  generation: number;
  /** undefined is uncertain provenance and must not be interpreted as local. */
  remoteHost: string | null | undefined;
  active: boolean;
  ready: PromptReadiness;
};

/** Ephemeral per-PTY prompt metadata. Starting a command invalidates it; a new
 * completed prompt must report the value again before the user can select it. */
export class TerminalKubeconfigCapture {
  private capture: Capture | null = null;
  private promptComplete = false;
  private rejectedMetadata = false;

  invalidate(): void { this.capture = null; this.promptComplete = false; this.rejectedMetadata = false; }
  observe(data: string, generation: number, cwd: string, now = Date.now()): void {
    const value = parseKubeconfigOsc(data);
    this.capture = value ? { ...value, generation, cwd, capturedAt: now } : null;
    this.rejectedMetadata = !value;
    this.promptComplete = false;
  }
  completePrompt(): void { this.promptComplete = this.capture !== null; }

  snapshot(scope: KubeconfigCaptureScope): TerminalKubeconfigSnapshot {
    if (!scope.active || scope.ptyId === null) return { available: false, reason: "Select an open local terminal first." };
    if (scope.remoteHost !== null) return { available: false, reason: "Only a verified local terminal can provide kubeconfig. SSH terminals are not supported." };
    if (!scope.ready.ready) return { available: false, reason: scope.ready.reason };
    if (this.rejectedMetadata) return { available: false, reason: "This shell could not provide a supported local KUBECONFIG value. Check the exported path or choose a kubeconfig file instead." };
    const value = this.capture;
    if (!value || !this.promptComplete || value.generation !== scope.generation || value.cwd !== scope.cwd || !scope.cwd) {
      return { available: false, reason: "Kubeconfig metadata is unavailable. Open a new local terminal with Husk shell integration, then return to an empty prompt." };
    }
    return { available: true, leafId: scope.leafId, ptyId: scope.ptyId, cwd: scope.cwd, kubeconfig: value.kubeconfig, defaultKubeconfigPath: value.defaultKubeconfigPath, capturedAt: value.capturedAt };
  }
}

/** Remove the private OSC from raw-output subscribers, including split chunks.
 * xterm still receives the original stream so its parser retains prompt order.
 * A recognized record is discarded until its terminator without buffering its
 * payload, so neither malformed nor overlong metadata reaches logs/AI context. */
export class KubeconfigOutputFilter {
  private candidate = "";
  private discarding = false;
  private escaped = false;

  consume(chunk: string): string {
    const prefixes = ["\x1b]779;", "\x9d779;"];
    let output = "";
    for (const char of chunk) {
      if (this.discarding) {
        if (char === "\x07" || char === "\x9c" || (this.escaped && char === "\\")) {
          this.discarding = false; this.escaped = false;
        } else this.escaped = char === "\x1b";
        continue;
      }
      this.candidate += char;
      while (this.candidate && !prefixes.some((prefix) => prefix.startsWith(this.candidate))) {
        output += this.candidate[0]; this.candidate = this.candidate.slice(1);
      }
      if (prefixes.includes(this.candidate)) { this.candidate = ""; this.discarding = true; }
    }
    return output;
  }
}
