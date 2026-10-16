/**
 * Terminal-local tool relevance, derived only from command text. This module
 * never reads app-global configuration, runs probes, or infers shell state.
 */
export const STATUS_TOOLS = ["kubernetes", "docker", "aws", "terraform"] as const;

export type StatusTool = (typeof STATUS_TOOLS)[number];

export const STATUS_TOOL_LABELS: Record<StatusTool, string> = {
  kubernetes: "Kubernetes",
  docker: "Docker",
  aws: "AWS",
  terraform: "Terraform",
};

export type StatusToolOverride = {
  kind: "context" | "profile" | "workspace";
  value: string;
  provenance: "command override";
};

export type StatusToolSignal = {
  tool: StatusTool;
  command: string;
  executable: "kubectl" | "helm" | "docker" | "aws" | "terraform";
  /** Arguments with literal shell quoting removed, excluding wrappers. */
  args: string[];
  /** A literal override in this command, not a verified or persistent target. */
  override: StatusToolOverride | null;
};

type Token = { value: string; dynamic: boolean };
type Environment = Map<string, Token>;

const SHELL_SYNTAX = new Set([
  "if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done",
  "case", "esac", "function", "select", "{", "}",
]);

/**
 * A deliberately small shell lexer, not a shell interpreter. Unsupported
 * control syntax, substitutions, redirections, and heredocs fail closed.
 * In particular, shell -c / ssh / echo arguments are never reparsed as code.
 */
function simpleCommands(command: string): Token[][] | null {
  if (command.length > 16_384) return null;
  const commands: Token[][] = [];
  let tokens: Token[] = [];
  let value = "";
  let started = false;
  let dynamic = false;
  let quote: "'" | '"' | null = null;

  const finishToken = () => {
    if (started) tokens.push({ value, dynamic });
    value = "";
    started = false;
    dynamic = false;
  };
  const finishCommand = () => {
    finishToken();
    if (tokens.length) commands.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else value += ch;
      continue;
    }
    if (ch === "\\") {
      const next = command[++i];
      if (next === undefined) return null;
      if (next === "\n") continue;
      if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) value += "\\";
      value += next;
      started = true;
      continue;
    }
    if (ch === "`") return null;
    if (ch === "$" && command[i + 1] === "(") return null;
    if (ch === "$") dynamic = true;
    if (quote === '"') {
      if (ch === '"') quote = null;
      else value += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === "#" && !started) {
      while (i < command.length && command[i] !== "\n") i += 1;
      finishCommand();
      continue;
    }
    if (/[()<>]/.test(ch)) return null;
    if (ch === ";" || ch === "\n" || ch === "|" || ch === "&") {
      if (ch === "&" && command[i + 1] !== "&") return null;
      if ((ch === "&" || ch === "|") && command[i + 1] === ch) i += 1;
      finishCommand();
      continue;
    }
    if (/\s/.test(ch)) {
      finishToken();
      continue;
    }
    if (/[?*\[\]~]/.test(ch)) dynamic = true;
    value += ch;
    started = true;
  }
  if (quote) return null;
  finishCommand();
  if (commands.some((part) => SHELL_SYNTAX.has(part[0].value))) return null;
  return commands;
}

function assignment(token: Token): [string, Token] | null {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(token.value);
  return match ? [match[1], { value: match[2], dynamic: token.dynamic }] : null;
}

function executableName(token: Token | undefined): string {
  if (!token || token.dynamic) return "";
  return token.value.slice(token.value.lastIndexOf("/") + 1);
}

/** Only wrappers with understood execution semantics are unwrapped. */
function unwrap(tokens: Token[]): { executable: string; args: Token[]; env: Environment } | null {
  const env: Environment = new Map();
  let at = 0;
  const takeAssignments = () => {
    while (at < tokens.length) {
      const entry = assignment(tokens[at]);
      if (!entry) break;
      env.set(...entry);
      at += 1;
    }
  };
  takeAssignments();
  while (at < tokens.length) {
    const name = executableName(tokens[at]);
    if (name === "env") {
      at += 1;
      while (at < tokens.length) {
        const value = tokens[at].value;
        if (value === "--") { at += 1; break; }
        if (value === "-i" || value === "--ignore-environment") {
          env.clear();
          at += 1;
        } else if (value === "-u" || value === "--unset") {
          if (!tokens[at + 1] || tokens[at + 1].dynamic) return null;
          env.delete(tokens[at + 1].value);
          at += 2;
        } else if (value.startsWith("--unset=")) {
          if (tokens[at].dynamic) return null;
          env.delete(value.slice("--unset=".length));
          at += 1;
        } else break;
      }
      takeAssignments();
      continue;
    }
    if (name === "command") {
      at += 1;
      if (tokens[at]?.value === "-p") at += 1;
      if (tokens[at]?.value === "--") at += 1;
      continue;
    }
    if (name === "sudo") {
      // sudo may remove or replace inherited variables. Never carry an outer
      // assignment through it, even when preservation was requested.
      env.clear();
      at += 1;
      while (tokens[at]?.value.startsWith("-")) {
        const value = tokens[at].value;
        if (value === "--") { at += 1; break; }
        if (["-n", "-E", "-H", "-S", "-k", "--non-interactive", "--preserve-env", "--set-home", "--stdin"].includes(value)) {
          at += 1;
        } else if (["-u", "-g", "--user", "--group"].includes(value)) {
          if (!tokens[at + 1] || tokens[at + 1].dynamic) return null;
          at += 2;
        } else return null;
      }
      takeAssignments();
      continue;
    }
    return { executable: name, args: tokens.slice(at + 1), env };
  }
  return null;
}

function literalValue(token: Token | undefined): string | null {
  if (!token || token.dynamic || !/^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,159}$/.test(token.value)) return null;
  return token.value;
}

const BOOLEAN_FLAGS = new Set([
  "--debug", "--no-debug", "--no-cli-pager", "--cli-auto-prompt", "--no-cli-auto-prompt",
  "--no-sign-request", "--no-verify-ssl", "--disable-compression", "--insecure-skip-tls-verify",
  "--help", "-h", "--version", "--verbose", "--quiet", "-q", "--all-namespaces", "-A",
]);

function commandOverride(
  executable: StatusToolSignal["executable"],
  args: Token[],
  env: Environment,
): StatusToolOverride | null {
  // An expanded argument may add or replace flags. We can still establish
  // relevance, but cannot establish the selected literal override.
  if (args.some((arg) => arg.dynamic)) return null;
  const flag = executable === "aws" ? "--profile"
    : executable === "helm" ? "--kube-context" : "--context";
  let value: string | null = null;
  if (executable !== "terraform") {
    for (let at = 0; at < args.length; at += 1) {
      const arg = args[at].value;
      if (arg === "--") break;
      // Docker's container command and kubectl exec's legacy payload can
      // contain arbitrary flags belonging to a different executable.
      if (executable === "docker" && !arg.startsWith("-")) break;
      if (executable === "kubectl" && ["exec", "attach", "run", "debug"].includes(arg)) break;
      const shortContext = executable === "docker" && arg === "-c";
      if (arg === flag || shortContext) {
        value = literalValue(args[++at]);
        if (!value) return null;
      } else if (arg.startsWith(`${flag}=`)) {
        value = literalValue({ value: arg.slice(flag.length + 1), dynamic: false });
        if (!value) return null;
      } else if (arg.startsWith("-") && !arg.includes("=") && !BOOLEAN_FLAGS.has(arg)) {
        // Unknown options may consume the next token as data, even if it
        // resembles our flag. Do not inspect another option's payload.
        at += 1;
      }
    }
  }
  const envName = executable === "aws"
    ? (env.has("AWS_PROFILE") ? "AWS_PROFILE" : "AWS_DEFAULT_PROFILE")
    : executable === "docker" ? "DOCKER_CONTEXT"
      : executable === "terraform" ? "TF_WORKSPACE"
        : executable === "helm" ? "HELM_KUBECONTEXT" : null;
  value ??= envName ? literalValue(env.get(envName)) : null;
  if (!value) return null;
  return {
    kind: executable === "aws" ? "profile" : executable === "terraform" ? "workspace" : "context",
    value,
    provenance: "command override",
  };
}

/**
 * Detect direct tool invocations, optionally wrapped in env, command, or sudo.
 * No aliases, output, config-switch results, inherited environment, or remote
 * payloads are inferred. Failed commands still indicate relevance, but an
 * override only says what was written in that command, never what succeeded.
 * Callers must keep pinned visibility preferences separate from these signals.
 */
export function detectStatusToolSignals(command: string): StatusToolSignal[] {
  const commands = simpleCommands(command);
  if (!commands) return [];
  const result: StatusToolSignal[] = [];
  for (const tokens of commands) {
    const invocation = unwrap(tokens);
    if (!invocation) continue;
    const { executable, args, env } = invocation;
    if (executable !== "kubectl" && executable !== "helm" && executable !== "docker"
      && executable !== "aws" && executable !== "terraform") continue;
    result.push({
      tool: executable === "kubectl" || executable === "helm" ? "kubernetes" : executable,
      command,
      executable,
      args: args.map((arg) => arg.value),
      override: commandOverride(executable, args, env),
    });
  }
  return result;
}

/** A display preference for an observed executable, never its arguments. */
export type CommandToolId = `cli:${string}`;

const COMMAND_TOOL_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

/** Validate stored display IDs without accepting paths, shell text, or markup. */
export function isCommandToolId(value: unknown): value is CommandToolId {
  return typeof value === "string" && value.startsWith("cli:")
    && COMMAND_TOOL_NAME.test(value.slice(4));
}

const COMMAND_TOOL_LABELS: Readonly<Record<string, string>> = {
  az: "Azure",
  gcloud: "Google Cloud",
  gsutil: "Google Cloud Storage",
  bq: "BigQuery",
  doctl: "DigitalOcean",
  hcloud: "Hetzner Cloud",
  oci: "Oracle Cloud",
  ibmcloud: "IBM Cloud",
  podman: "Podman",
  nerdctl: "nerdctl",
  tofu: "OpenTofu",
  pulumi: "Pulumi",
  ansible: "Ansible",
  "ansible-playbook": "Ansible Playbook",
  packer: "Packer",
  vault: "Vault",
  nomad: "Nomad",
  consul: "Consul",
  psql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mongosh: "MongoDB",
  "redis-cli": "Redis",
  sqlite3: "SQLite",
  git: "Git",
  gh: "GitHub CLI",
  glab: "GitLab CLI",
  npm: "npm",
  pnpm: "pnpm",
  yarn: "Yarn",
  bun: "Bun",
  cargo: "Cargo",
  go: "Go",
  uv: "uv",
  poetry: "Poetry",
  pip: "pip",
  pip3: "pip",
  brew: "Homebrew",
};

export function commandToolLabel(id: CommandToolId): string {
  const executable = id.slice(4);
  // Own-property lookup matters for valid custom names such as "constructor".
  return Object.prototype.hasOwnProperty.call(COMMAND_TOOL_LABELS, executable)
    ? COMMAND_TOOL_LABELS[executable] : executable;
}

const NON_ACTIVITY_COMMANDS = new Set([
  // Already represented by the richer, command-bound signals above.
  "kubectl", "helm", "docker", "aws", "terraform",
  // Shell builtins and common housekeeping do not add a useful tool badge.
  ".", ":", "alias", "unalias", "builtin", "cd", "pwd", "echo", "printf", "type",
  "which", "where", "whence", "help", "hash", "rehash", "set", "unset", "export",
  "setopt", "unsetopt", "shopt", "typeset", "declare", "local", "readonly", "read",
  "readarray", "mapfile", "getopts", "shift", "return", "exit", "logout", "break",
  "continue", "trap", "enable", "ulimit", "umask", "let", "test", "true", "false",
  "history", "fc", "clear", "reset", "jobs", "fg", "bg", "wait", "kill", "disown",
  "pushd", "popd", "dirs", "bind", "bindkey", "complete", "compgen", "autoload",
  "ls", "cat", "head", "tail", "grep", "egrep", "fgrep", "sed", "awk", "cut",
  "sort", "uniq", "wc", "tr", "tee", "find", "less", "more", "sleep", "date",
  "cp", "mv", "rm", "mkdir", "rmdir", "touch", "ln", "chmod", "chown", "chgrp",
  // Do not infer commands hidden inside shells, remote payloads, or wrappers
  // whose argument grammar this detector does not understand.
  "sh", "bash", "zsh", "fish", "dash", "ash", "ksh", "csh", "tcsh", "nu",
  "pwsh", "powershell", "cmd", "cmd.exe", "wsl", "ssh", "mosh", "telnet", "rlogin",
  "eval", "exec", "source", "time", "coproc", "watch", "timeout", "nohup", "nice",
  "ionice", "xargs", "parallel", "script", "scriptreplay", "login", "su", "chroot",
  "nsenter", "env", "command", "sudo",
]);

/**
 * Broad, best-effort activity badges, not environment discovery. Only literal
 * direct executables (including custom script basenames) are reported. Shell
 * aliases are not resolved; a badge does not assert installation or success.
 * Last occurrences win so repeated tools retain meaningful recency ordering.
 */
export function detectCommandToolActivities(command: string): {
  id: CommandToolId; label: string; executable: string;
}[] {
  const commands = simpleCommands(command);
  if (!commands) return [];
  const activities = new Map<CommandToolId, { id: CommandToolId; label: string; executable: string }>();
  for (const tokens of commands) {
    const invocation = unwrap(tokens);
    if (!invocation) continue;
    const { executable } = invocation;
    const id = `cli:${executable}`;
    if (!isCommandToolId(id) || NON_ACTIVITY_COMMANDS.has(executable)) continue;
    activities.delete(id);
    activities.set(id, { id, label: commandToolLabel(id), executable });
  }
  return [...activities.values()];
}
