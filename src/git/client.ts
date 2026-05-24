import { invoke } from "@tauri-apps/api/core";
import { getWorkspaceRoot } from "../workspace/store";
import { shq } from "../lib/shellQuote";

type ShellOutput = { stdout: string; stderr: string; exit_code: number | null };

async function git(args: string): Promise<string> {
  const out = await invoke<ShellOutput>("shell_run_command", {
    command: `git ${args}`,
    cwd: getWorkspaceRoot() || null,
    timeout_secs: 15,
  });
  if (out.exit_code !== 0) throw new Error(out.stderr || `git ${args} failed`);
  return out.stdout;
}

export async function isRepo(): Promise<boolean> {
  try {
    await git("rev-parse --is-inside-work-tree");
    return true;
  } catch {
    return false;
  }
}

export async function currentBranch(): Promise<string> {
  return (await git("rev-parse --abbrev-ref HEAD").catch(() => "")).trim();
}

export type GitFile = { path: string; index: string; work: string; staged: boolean };

export async function status(): Promise<GitFile[]> {
  const out = await git("status --porcelain=v1").catch(() => "");
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const index = line[0] ?? " ";
      const work = line[1] ?? " ";
      return { path: line.slice(3), index, work, staged: index !== " " && index !== "?" };
    });
}

export const stageFile = (p: string) => git(`add -- ${shq(p)}`);
export const unstageFile = (p: string) => git(`restore --staged -- ${shq(p)}`);
export const commit = (msg: string) => git(`commit -m ${shq(msg)}`);

export function diffFile(p: string, staged: boolean): Promise<string> {
  return git(`diff ${staged ? "--cached " : ""}-- ${shq(p)}`).catch(() => "");
}

export function log(n = 80): Promise<string> {
  return git(`log --oneline --graph --decorate -n ${n}`).catch(() => "");
}
