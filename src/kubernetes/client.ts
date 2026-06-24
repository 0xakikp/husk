import { invoke } from "@tauri-apps/api/core";
import { shq } from "../lib/shellQuote";

export type K8sPod = {
  namespace: string;
  name: string;
  ready: string;
  status: string;
  restarts: string;
  age: string;
};

type ShellOutput = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
};

async function shell(cmd: string, timeoutSecs = 15): Promise<string> {
  const out = await invoke<ShellOutput>("shell_run_command", {
    command: cmd,
    cwd: null,
    timeout_secs: timeoutSecs,
  });
  if (out.exit_code !== 0) throw new Error(out.stderr || `exit ${out.exit_code ?? "?"}`);
  return out.stdout;
}

export async function checkKubectl(): Promise<boolean> {
  try {
    await shell("kubectl version --client=true");
    return true;
  } catch {
    return false;
  }
}

export async function currentContext(): Promise<string> {
  return (await shell("kubectl config current-context").catch(() => "")).trim();
}

export async function listContexts(): Promise<string[]> {
  const s = await shell("kubectl config get-contexts -o name").catch(() => "");
  return s.trim().split("\n").filter(Boolean);
}

export const useContext = (ctx: string) => shell(`kubectl config use-context ${shq(ctx)}`);

export async function listPods(): Promise<K8sPod[]> {
  // Shorter timeout: listing all pods across all namespaces can hang on large clusters
  const s = await shell("kubectl get pods -A --no-headers", 8);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
      return {
        namespace: p[0] ?? "",
        name: p[1] ?? "",
        ready: p[2] ?? "",
        status: p[3] ?? "",
        restarts: p[4] ?? "",
        age: p[5] ?? "",
      };
    });
}
