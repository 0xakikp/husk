import { scanForSecrets } from "../ai/contextItems";

export type SafeTimelineCommand = {
  display: string;
  command?: string;
  sensitive: boolean;
};

const SENSITIVE_ARGUMENT_RE = /(?:^|\s)(?:--?(?:api[-_]?key|token|secret|password|passwd|authorization)|-u)\s*(?:=|\s)\s*\S+|\b(?:api[-_]?key|token|secret|password|passwd|authorization)\s*=/i;
const URL_CREDENTIAL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;
const SENSITIVE_ENV_RE = /(?:^|\s)[A-Z_][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*=/i;
const AUTH_HEADER_RE = /authorization\s*:\s*(?:basic|bearer)\s+\S+/i;

/** Commands are useful Timeline context, but a command line can itself carry a
 * credential. In that case keep only a neutral event marker — never a partial
 * redaction that might miss the second secret on the same line. */
export function safeTimelineCommand(raw: string): SafeTimelineCommand {
  const command = raw.trim().replace(/\s+/g, " ").slice(0, 480);
  const sensitive = !command
    || scanForSecrets("terminal command", command).length > 0
    || SENSITIVE_ARGUMENT_RE.test(command)
    || URL_CREDENTIAL_RE.test(command)
    || SENSITIVE_ENV_RE.test(command)
    || AUTH_HEADER_RE.test(command);
  return sensitive
    ? { display: "[sensitive command]", sensitive: true }
    : { display: command, command, sensitive: false };
}
