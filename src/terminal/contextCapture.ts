import type { PromptReadiness } from "./promptDraft";

export const CONTEXT_OSC = 781;
export const MAX_TERMINAL_CONTEXT_BYTES = 24_576;
const MAX_PATH_BYTES = 8_192;
const MAX_CONTEXT_BYTES = 1_024;
const PREFIX = "husk;context;1;";
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Only selected exported paths/names. Never credentials or Docker host URLs. */
export type TerminalContextMetadata = {
  kubeconfig: string | null;
  defaultKubeconfigPath: string | null;
  dockerConfig: string | null;
  dockerContext: string | null;
  dockerHost: boolean;
};

export type TerminalContextSnapshot =
  | ({ available: true; leafId: number; ptyId: number; cwd: string; capturedAt: number } & TerminalContextMetadata)
  | { available: false; reason: string };

export function parseContextOsc(data: string): TerminalContextMetadata | null {
  if (!data.startsWith(PREFIX) || data.length > PREFIX.length + MAX_TERMINAL_CONTEXT_BYTES * 3 + 5) return null;
  const fields = data.slice(PREFIX.length).split(";");
  if (fields.length !== 5 || !/^[01]$/.test(fields[4])) return null;
  try {
    const values = fields.slice(0, 4).map(decodeURIComponent);
    const encoder = new TextEncoder();
    const lengths = values.map((value) => encoder.encode(value).byteLength);
    if (values.some((value) => CONTROL.test(value))
      || lengths.some((size, index) => size > (index === 3 ? MAX_CONTEXT_BYTES : MAX_PATH_BYTES))
      || lengths.reduce((sum, size) => sum + size, 0) + 5 > MAX_TERMINAL_CONTEXT_BYTES) return null;
    const [kubeconfig, defaultKubeconfigPath, dockerConfig, dockerContext] = values.map((value) => value || null);
    if (kubeconfig && defaultKubeconfigPath) return null;
    // Defaults must be absolute and sourced from the terminal's exported HOME.
    // Explicit path selections may be relative to the captured terminal cwd.
    if (defaultKubeconfigPath && !/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(defaultKubeconfigPath)) return null;
    return { kubeconfig, defaultKubeconfigPath, dockerConfig, dockerContext, dockerHost: fields[4] === "1" };
  } catch { return null; }
}

export type ContextCaptureScope = {
  leafId: number;
  ptyId: number | null;
  cwd: string;
  generation: number;
  /** Undefined means unknown provenance, not a local shell. */
  remoteHost: string | null | undefined;
  active: boolean;
  ready: PromptReadiness;
};

type Capture = TerminalContextMetadata & { generation: number; cwd: string; capturedAt: number };

/** Ephemeral prompt metadata, invalidated on execution/scope transitions. */
export class TerminalContextCapture {
  private capture: Capture | null = null;
  private promptComplete = false;
  private rejectedMetadata = false;

  invalidate(): void { this.capture = null; this.promptComplete = false; this.rejectedMetadata = false; }
  observe(data: string, generation: number, cwd: string, now = Date.now()): void {
    const value = parseContextOsc(data);
    this.capture = value ? { ...value, generation, cwd, capturedAt: now } : null;
    this.rejectedMetadata = !value;
    this.promptComplete = false;
  }
  completePrompt(): void { this.promptComplete = this.capture !== null; }

  snapshot(scope: ContextCaptureScope): TerminalContextSnapshot {
    if (!scope.active || scope.ptyId === null) return { available: false, reason: "Select an open local terminal first." };
    if (scope.remoteHost !== null) return { available: false, reason: "Context detection requires a verified local terminal. Remote and unknown shells are not inspected." };
    if (!scope.ready.ready) return { available: false, reason: scope.ready.reason };
    if (this.rejectedMetadata) return { available: false, reason: "This shell could not provide supported local context metadata." };
    const value = this.capture;
    if (!value || !this.promptComplete || value.generation !== scope.generation || value.cwd !== scope.cwd || !scope.cwd) {
      return { available: false, reason: "Context metadata is unavailable. Return to a fresh local prompt with Husk shell integration." };
    }
    const { generation: _generation, ...metadata } = value;
    return { available: true, leafId: scope.leafId, ptyId: scope.ptyId, ...metadata };
  }
}
