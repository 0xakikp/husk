import type { StatusCommandInvocation, StatusCommandToken, StatusToolOverride } from "./statusBarTools";

type Kind = StatusToolOverride["kind"];
type Selector = {
  kind: Kind; flags: string[]; env?: string[]; spaces?: boolean;
  /** Alternative ways of selecting one target that cannot be combined. */
  exclusiveGroups?: string[][];
};
const observed = (kind: Kind, value: string): StatusToolOverride => ({ kind, value, provenance: "command override" });
function valueOf(token: StatusCommandToken | undefined, spaces = false): string | null {
  if (!token || token.dynamic || token.value.length > 160) return null;
  const pattern = spaces ? /^[A-Za-z0-9_./][A-Za-z0-9_.:/@+ -]*$/ : /^[A-Za-z0-9_./][A-Za-z0-9_.:/@+-]*$/;
  return pattern.test(token.value) ? token.value : null;
}

const BOOLEANS = new Set([
  "--debug", "--help", "--version", "--verbose", "--quiet", "-h", "-v", "-q",
  "--only-show-errors", "--all", "--yes", "-y", "--no-wait", "--force",
  "--raw-output", "--no-retry", "--remote", "--very-verbose", "--offline",
]);
const PAYLOAD_FLAGS = new Set(["--set", "--add", "--remove", "--parameters", "--args", "--scripts", "--script-content"]);

/** A small selector reader, not a command interpreter. Runners accept only
 * known option arities: guessing a boolean takes a value could skip the nested
 * program and mistake its flags for ours. Variadic payloads and `--` end
 * inspection; other non-runner CLIs skip one unknown option value. */
function selectors(invocation: StatusCommandInvocation, specs: Selector[], options: {
  args?: StatusCommandToken[]; stopAtOperand?: boolean; stopWords?: string[];
  booleans?: string[]; valueFlags?: string[]; blockedFlags?: string[];
} = {}): StatusToolOverride[] {
  const args = options.args ?? invocation.args;
  if (args.some((arg) => arg.dynamic)) return [];
  const found = new Map<Kind, string>();
  const selectedGroups = new Map<Kind, number>();
  for (let at = 0; at < args.length; at++) {
    const text = args[at].value;
    if (text === "--" || options.stopWords?.includes(text)) break;
    if (PAYLOAD_FLAGS.has(text)) {
      if (options.stopAtOperand) return [];
      break;
    }
    if (!text.startsWith("-")) { if (options.stopAtOperand) break; else continue; }
    const equal = text.indexOf("=");
    const flag = equal < 0 ? text : text.slice(0, equal);
    if (options.blockedFlags?.includes(flag)) return [];
    const spec = specs.find((entry) => entry.flags.includes(flag));
    if (spec) {
      const group = spec.exclusiveGroups?.findIndex((entries) => entries.includes(flag));
      if (group !== undefined) {
        if (selectedGroups.has(spec.kind) && selectedGroups.get(spec.kind) !== group) return [];
        selectedGroups.set(spec.kind, group);
      }
      const token = equal < 0 ? args[++at] : { value: text.slice(equal + 1), dynamic: false };
      const value = valueOf(token, spec.spaces);
      // Invalid later selectors must not fall back to earlier flags or env.
      if (!value) return [];
      found.set(spec.kind, value);
    } else {
      const boolean = options.booleans?.includes(flag) || (!options.stopAtOperand && BOOLEANS.has(flag));
      if (options.stopAtOperand && !boolean && !options.valueFlags?.includes(flag)) return [];
      if (equal < 0 && !boolean && !args[++at]) return [];
    }
  }
  return specs.flatMap((spec) => {
    let value = found.get(spec.kind) ?? null;
    if (!value) {
      const name = spec.env?.find((key) => invocation.env.has(key));
      value = name ? valueOf(invocation.env.get(name), spec.spaces) : null;
    }
    return value ? [observed(spec.kind, value)] : [];
  });
}

/** Only invocation options before a program's payload are interpreted. These
 * are requested selectors, never authentication/installation/health evidence. */
export function adapterOverrides(invocation: StatusCommandInvocation): StatusToolOverride[] {
  const { executable, args } = invocation;
  switch (executable) {
    case "oci": return selectors(invocation, [
      { kind: "profile", flags: ["--profile"], env: ["OCI_CLI_PROFILE"] },
      { kind: "region", flags: ["--region"], env: ["OCI_CLI_REGION"] },
    ]);
    case "az": return selectors(invocation, [{ kind: "subscription", flags: ["--subscription"], spaces: true }]);
    case "gcloud": return selectors(invocation, [
      { kind: "project", flags: ["--project"], env: ["CLOUDSDK_CORE_PROJECT"] },
      { kind: "configuration", flags: ["--configuration"], env: ["CLOUDSDK_ACTIVE_CONFIG_NAME"] },
    ], { blockedFlags: ["--flags-file"] });
    case "podman": {
      // --url/CONTAINER_HOST can choose a different endpoint and can contain
      // credentials. Never expose their payload or guess which selector wins.
      if (invocation.env.has("CONTAINER_HOST")) return [];
      return selectors(invocation, [{ kind: "connection", flags: ["--connection", "-c"], env: ["CONTAINER_CONNECTION"] }], {
        stopAtOperand: true, blockedFlags: ["--url"],
        booleans: ["--remote", "-r", "--help", "-h", "--version", "-v", "--syslog", "--transient-store"],
        valueFlags: ["--log-level", "--identity", "--config", "--root", "--runroot", "--runtime", "--tmpdir", "--storage-driver", "--storage-opt"],
      });
    }
    case "colima": return selectors(invocation, [{ kind: "profile", flags: ["--profile", "-p"] }], { stopWords: ["ssh", "exec", "x"] });
    case "orb": case "orbctl": {
      const start = ["run", "shell"].includes(args[0]?.value) ? 1 : 0;
      return selectors(invocation, [{ kind: "machine", flags: ["--machine", "-m"] }], {
        args: args.slice(start), stopAtOperand: true,
        booleans: ["--help", "-h", "--version"], valueFlags: ["--user", "-u"],
      });
    }
    case "uv": {
      // Do not read --python from the nested program or arbitrary uv subcommands.
      if (args[0]?.value !== "run") return [];
      return selectors(invocation, [{ kind: "runtime", flags: ["--python", "-p"], env: ["UV_PYTHON"] }], {
        args: args.slice(1), stopAtOperand: true,
        booleans: ["--no-sync", "--locked", "--frozen", "--isolated", "--no-project", "--active", "--no-dev", "--all-extras",
          "--module", "-m", "--script", "-s", "--offline", "--help", "-h", "--verbose", "-v", "--quiet", "-q"],
        valueFlags: ["--with", "--with-editable", "--with-requirements", "--extra", "--group", "--no-group", "--directory", "--project", "--package", "--env-file"],
      });
    }
    case "conda": {
      if (args[0]?.value !== "run") return [];
      const selected = selectors(invocation, [{
        kind: "environment", flags: ["--name", "-n", "--prefix", "-p"],
        exclusiveGroups: [["--name", "-n"], ["--prefix", "-p"]],
      }], {
        args: args.slice(1), stopAtOperand: true,
        booleans: ["--dev", "--debug-wrapper-scripts", "--no-capture-output", "--live-stream", "-s", "--help", "-h", "--verbose", "-v"],
        valueFlags: ["--cwd"],
      });
      return selected;
    }
    case "ssh": return sshSelectors(args);
    // A VIRTUAL_ENV variable or the spelling `python3` does not prove which
    // interpreter/environment the shell selected. Keep that activity-only.
    default: return [];
  }
}

function sshSelectors(args: StatusCommandToken[]): StatusToolOverride[] {
  let port: string | null = null;
  for (let at = 0; at < args.length; at++) {
    const token = args[at];
    if (token.dynamic) return [];
    const text = token.value;
    if (!text.startsWith("-") || text === "--") {
      const destination = text === "--" ? args[at + 1] : token;
      const host = valueOf(destination);
      // URI/config/IPv6 resolution is deliberately not inferred. The supplied
      // hostname may be a config alias, so the UI labels it command-selected.
      if (!host || !/^(?:[A-Za-z0-9_.+-]+@)?[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(host)) return [];
      return [observed("host", host), ...(port ? [observed("port", port)] : [])];
    }
    if (text === "-p" || /^-p\d+$/.test(text)) {
      const value = text === "-p" ? valueOf(args[++at]) : text.slice(2);
      if (!value || !/^\d+$/.test(value) || +value < 1 || +value > 65535) return [];
      // OpenSSH takes the first -p value, unlike many other CLI parsers.
      port ??= value;
    } else if (/^-[46AaCfKkMNnqTtVvXxYy]+$/.test(text)) {
      if (text.includes("V")) return []; // version query, not a connection request
    } else if (/^-[bBDEeIiJLlmRSWw]$/.test(text)) {
      if (!args[++at] || args[at].dynamic) return [];
    } else if (/^-[bBDEeIiJLlmRSWw].+/.test(text)) {
      continue;
    } else {
      // -o/-F may replace hostname/port, -G only expands config, -O controls an
      // existing master. Prefer no target rather than a misleading endpoint.
      return [];
    }
  }
  return [];
}
