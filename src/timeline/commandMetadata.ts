import { scanForSecrets } from "../ai/contextItems";
import type { TimelineEvent } from "./store";

export const MAX_TIMELINE_COMMAND_LENGTH = 480;
export const EXACT_TIMELINE_COMMAND_FORMAT = "exact-v1";

export type SafeTimelineCommand = {
  display: string;
  command?: string;
  sensitive: boolean;
  truncated?: true;
  unsupported?: true;
};

const SENSITIVE_ARGUMENT_RE = /(?:^|\s)(?:--?(?:api[-_]?key|token|secret|password|passwd|authorization)|-u)\s*(?:=|\s)\s*\S+|\b(?:api[-_]?key|token|secret|password|passwd|authorization)\s*=/i;
const URL_CREDENTIAL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;
const SENSITIVE_ENV_RE = /(?:^|\s)[A-Z_][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*=/i;
const AUTH_HEADER_RE = /authorization\s*:\s*(?:basic|bearer)\s+\S+/i;
const COMMAND_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

/** Commands are useful Timeline context, but a command line can itself carry a
 * credential. In that case keep only a neutral event marker — never a partial
 * redaction that might miss the second secret on the same line. */
export function safeTimelineCommand(raw: string): SafeTimelineCommand {
  // Scan the entire original line before truncating its display. A credential
  // near the end (or crossing the display boundary) must hide the whole event.
  const sensitive = !raw.trim()
    || scanForSecrets("terminal command", raw).length > 0
    || SENSITIVE_ARGUMENT_RE.test(raw)
    || URL_CREDENTIAL_RE.test(raw)
    || SENSITIVE_ENV_RE.test(raw)
    || AUTH_HEADER_RE.test(raw);
  if (sensitive) return { display: "[sensitive command]", sensitive: true };
  // Never turn a script/control sequence into a different single-line command.
  if (COMMAND_CONTROL_RE.test(raw)) {
    return { display: "[multiline or control-character command]", sensitive: false, unsupported: true };
  }
  const display = raw.trim().replace(/\s+/g, " ");
  if (raw.length > MAX_TIMELINE_COMMAND_LENGTH) {
    return { display: `${display.slice(0, MAX_TIMELINE_COMMAND_LENGTH - 1)}…`, sensitive: false, truncated: true };
  }
  // Keep the command byte-for-byte as received. Collapsing quoted whitespace
  // or trimming an escaped trailing space can change what a copied line does.
  return { display, command: raw, sensitive: false };
}

/** The native store caps metadata, but old rows may contain a cut-off JSON
 * document. Malformed/non-object metadata must never fall back to a summary. */
export function readTimelineMetadata(event: Pick<TimelineEvent, "metadata_json">): Record<string, unknown> {
  if (!event.metadata_json || event.metadata_json.length > 16_000) return {};
  try {
    const value: unknown = JSON.parse(event.metadata_json);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/** A copyable *recorded* command, not evidence that it is safe to execute.
 * Older rows normalized whitespace; tell the UI rather than claiming an exact
 * original. At the legacy cap the line may be truncated, so withhold it. */
export function readTimelineCommand(event: TimelineEvent): { command: string; exact: boolean } | null {
  if ((event.event_type !== "command" && event.event_type !== "command_failed") || event.sensitivity !== 0) return null;
  const metadata = readTimelineMetadata(event);
  if (metadata.redacted || metadata.sensitive || metadata.truncated || metadata.unsupported) return null;
  if (typeof metadata.command !== "string") return null;
  if (metadata.commandFormat !== undefined && metadata.commandFormat !== EXACT_TIMELINE_COMMAND_FORMAT) return null;
  const exact = metadata.commandFormat === EXACT_TIMELINE_COMMAND_FORMAT;
  if (!exact && metadata.command.length >= MAX_TIMELINE_COMMAND_LENGTH) return null;
  const safe = safeTimelineCommand(metadata.command);
  return safe.command !== undefined ? { command: safe.command, exact } : null;
}
