import type { SshConnection } from "../remote/connectionManager";

export type SftpTarget = {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  authType?: "agent" | "key" | "password";
  jumpHost?: string;
};
const PREFIX = "husk-sftp:";
const safeText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value);

/** Public connection metadata only; never encode passwords or passphrases. */
export function validateSftpTarget(value: unknown): SftpTarget {
  if (!value || typeof value !== "object") throw new Error("Invalid SFTP connection details.");
  const input = value as SftpTarget;
  if (!safeText(input.host) || !/^[a-zA-Z0-9_\[\].:%-]+$/.test(input.host) || input.host.startsWith("-")) throw new Error("Enter a hostname, IP address or SSH-config alias.");
  if (input.user !== undefined && (!safeText(input.user) || !/^[a-zA-Z0-9_.-]+$/.test(input.user) || input.user.startsWith("-"))) throw new Error("Invalid SSH username.");
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) throw new Error("Port must be between 1 and 65535.");
  if (input.identityFile !== undefined && !safeText(input.identityFile)) throw new Error("Invalid identity-file path.");
  if (input.jumpHost !== undefined && !safeText(input.jumpHost)) throw new Error("Invalid jump host.");
  if (input.authType !== undefined && !["agent", "key", "password"].includes(input.authType)) throw new Error("Unsupported authentication method.");
  return { host: input.host, ...(input.user ? { user: input.user } : {}), ...(input.port ? { port: input.port } : {}),
    ...(input.identityFile ? { identityFile: input.identityFile } : {}), ...(input.authType ? { authType: input.authType } : {}),
    ...(input.jumpHost ? { jumpHost: input.jumpHost } : {}) };
}

export function encodeSftpTarget(target: SftpTarget): string {
  return PREFIX + encodeURIComponent(JSON.stringify(validateSftpTarget(target)));
}
export function decodeSftpTarget(reference: string): SftpTarget {
  if (reference.startsWith(PREFIX)) return validateSftpTarget(JSON.parse(decodeURIComponent(reference.slice(PREFIX.length))));
  const at = reference.lastIndexOf("@");
  return validateSftpTarget(at >= 0 ? { host: reference.slice(at + 1), user: reference.slice(0, at) } : { host: reference });
}
export function sftpTargetFromConnection(connection: SshConnection): SftpTarget {
  return validateSftpTarget({ host: connection.host, user: connection.user || undefined, port: connection.port,
    authType: connection.authType, identityFile: connection.authType === "key" ? connection.privateKeyPath || undefined : undefined,
    jumpHost: connection.jumpHost || undefined });
}
export function sftpTargetLabel(target: SftpTarget): string {
  return `${target.user ? `${target.user}@` : ""}${target.host}${target.port ? `:${target.port}` : ""}`;
}

/** Strict local-only parser. Unknown flags or shell syntax require a saved profile. */
export function parseSshFileTarget(command: string): SftpTarget | null {
  if (/[\n\r\x00$`;&|<>]/.test(command)) return null;
  const words: string[] = [];
  let word = "", quote = "", escaped = false;
  for (const char of command.trim()) {
    if (escaped) { word += char; escaped = false; }
    else if (char === "\\" && quote !== "'") escaped = true;
    else if (quote) { if (char === quote) quote = ""; else word += char; }
    else if (char === "'" || char === '"') quote = char;
    else if (/\s/.test(char)) { if (word) words.push(word); word = ""; }
    else word += char;
  }
  if (quote || escaped) return null;
  if (word) words.push(word);
  if (words[0] === "command") words.shift();
  if (!["ssh", "/usr/bin/ssh", "/bin/ssh"].includes(words.shift() || "")) return null;
  const target: Partial<SftpTarget> = {};
  while (words.length) {
    const arg = words.shift()!;
    if (["-v", "-vv", "-vvv", "-t", "-tt"].includes(arg)) continue;
    if (arg === "--") break;
    if (!arg.startsWith("-")) { words.unshift(arg); break; }
    const flag = arg.slice(0, 2);
    if (!["-p", "-l", "-i", "-J"].includes(flag)) return null;
    const value = arg.length > 2 ? arg.slice(2) : words.shift();
    if (!value) return null;
    if (flag === "-p") { if (!/^\d+$/.test(value) || target.port !== undefined) return null; target.port = Number(value); }
    if (flag === "-l") { if (target.user) return null; target.user = value; }
    if (flag === "-i") { if (target.identityFile) return null; target.identityFile = value; target.authType = "key"; }
    if (flag === "-J") { if (target.jumpHost) return null; target.jumpHost = value; }
  }
  if (words.length !== 1 || words[0].startsWith(PREFIX)) return null; // Never treat a shell destination as an internal reference.
  try {
    const destination = decodeSftpTarget(words[0]);
    if (destination.user && target.user && destination.user !== target.user) return null;
    return validateSftpTarget({ ...destination, ...target });
  } catch { return null; }
}
