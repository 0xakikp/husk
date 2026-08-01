import { invoke } from "@tauri-apps/api/core";
import { getWorkspaceRoot } from "../workspace/store";
import { shq, tokenizeCommand } from "../lib/shellQuote";

type ShellOutput = { stdout: string; stderr: string; exit_code: number | null };

async function git(args: string, cwd?: string | null): Promise<string> {
  const parsed = tokenizeCommand(args);
  const out = await invoke<ShellOutput>("shell_run_command", {
    program: "git",
    args: parsed,
    cwd: (cwd ?? getWorkspaceRoot()) || null,
    timeout_secs: 15,
  });
  if (out.exit_code !== 0) throw new Error(out.stderr || `git ${args} failed`);
  return out.stdout;
}

export async function isRepo(cwd?: string | null): Promise<boolean> {
  try {
    await git("rev-parse --is-inside-work-tree", cwd);
    return true;
  } catch {
    return false;
  }
}

export async function currentBranch(cwd?: string | null): Promise<string> {
  return (await git("rev-parse --abbrev-ref HEAD", cwd).catch(() => "")).trim();
}

export async function branchAheadBehind(cwd?: string | null): Promise<{ ahead: number; behind: number }> {
  const out = await git("rev-list --left-right --count HEAD...@{u}", cwd).catch(() => "");
  const [ahead = 0, behind = 0] = out.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
  return { ahead, behind };
}

export type GitFile = { path: string; index: string; work: string; staged: boolean };

export async function status(cwd?: string | null): Promise<GitFile[]> {
  const out = await git("status --porcelain=v1", cwd).catch(() => "");
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
export const push = () => git("push");
export const pull = () => git("pull");
export const fetch = () => git("fetch");

/**
 * The diff a commit would capture: staged changes if anything is staged, else the
 * unstaged working tree.
 *
 * Truncated deliberately. A large refactor produces a diff far past both the shell
 * bridge's 256KB stdout cap and any model's context, and the first few thousand
 * lines characterise a change well enough to describe it.
 */
export async function diffForCommit(cwd?: string | null, maxChars = 8000): Promise<string> {
  const staged = await git("diff --staged --stat", cwd).catch(() => "");
  const useStaged = staged.trim().length > 0;
  const body = await git(`diff${useStaged ? " --staged" : ""}`, cwd).catch(() => "");
  const text = body.trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… diff truncated at ${maxChars} characters`;
}

export function diffFile(p: string, staged: boolean): Promise<string> {
  return git(`diff ${staged ? "--cached " : ""}-- ${shq(p)}`).catch(() => "");
}

export type BlameLine = {
  hash: string;
  author: string;
  date: string;
  line: string;
};

export async function blameFile(p: string): Promise<BlameLine[]> {
  const out = await git(`blame --line-porcelain -- ${shq(p)}`).catch(() => "");
  const lines: BlameLine[] = [];
  const raw = out.split("\n");
  let current: Partial<BlameLine> = {};
  for (const line of raw) {
    if (line.startsWith("\t")) {
      current.line = line.slice(1);
      if (current.hash && current.author && current.date) {
        lines.push(current as BlameLine);
      }
      current = {};
    } else if (line.startsWith("author ")) {
      current.author = line.slice(7);
    } else if (line.startsWith("author-time ")) {
      const ts = parseInt(line.slice(12), 10);
      current.date = new Date(ts * 1000).toLocaleDateString();
    } else if (/^[0-9a-f]{40}/.test(line)) {
      current.hash = line.slice(0, 8);
    }
  }
  return lines;
}

export function log(n = 80): Promise<string> {
  return git(`log --oneline --graph --decorate -n ${n}`).catch(() => "");
}

export type CommitEntry = {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  date: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export async function structuredLog(n = 80): Promise<CommitEntry[]> {
  // Single shell call: custom format + --stat for all commits at once
  const out = await git(
    `log --format="HUSK_COMMIT|%H|%h|%s|%an|%ae|%ad" --date=short --stat -n ${n}`
  ).catch(() => "");

  const entries: CommitEntry[] = [];
  const lines = out.split("\n");
  let current: CommitEntry | null = null;
  let statBuffer: string[] = [];

  const flush = () => {
    if (!current) return;
    current.filesChanged = statBuffer.filter((l) => l.includes("|")).length;
    const summary = statBuffer.find((l) => /\d+ file.*changed/.test(l));
    if (summary) {
      const ins = summary.match(/(\d+) insertion/);
      const del = summary.match(/(\d+) deletion/);
      current.insertions = ins ? parseInt(ins[1]!, 10) : 0;
      current.deletions = del ? parseInt(del[1]!, 10) : 0;
    }
    entries.push(current);
    current = null;
    statBuffer = [];
  };

  for (const line of lines) {
    if (line.startsWith("HUSK_COMMIT|")) {
      flush();
      const parts = line.slice("HUSK_COMMIT|".length).split("|");
      if (parts.length >= 6) {
        const [hash, shortHash, subject, authorName, authorEmail, date] = parts;
        current = {
          hash: hash ?? "",
          shortHash: shortHash ?? "",
          subject: subject ?? "",
          authorName: authorName ?? "",
          authorEmail: authorEmail ?? "",
          date: date ?? "",
          filesChanged: 0,
          insertions: 0,
          deletions: 0,
        };
      }
    } else if (current) {
      statBuffer.push(line);
    }
  }
  flush();
  return entries;
}

export type GhIssue = {
  number: number;
  title: string;
  author: { login: string };
  state: string;
  createdAt: string;
  labels: { name: string; color: string }[];
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function hasGhCli(): Promise<boolean> {
  try {
    const out = await withTimeout(
      invoke<ShellOutput>("shell_run_command", {
        program: "gh",
        args: ["--version"],
        cwd: getWorkspaceRoot() || null,
        timeout_secs: 5,
      }),
      6000,
      "gh --version"
    );
    return out.exit_code === 0;
  } catch {
    return false;
  }
}

export async function listIssues(): Promise<
  { kind: "ok"; issues: GhIssue[] } | { kind: "error"; message: string }
> {
  try {
    const out = await withTimeout(
      invoke<ShellOutput>("shell_run_command", {
        program: "gh",
        args: ["issue", "list", "--json", "number,title,author,state,createdAt,labels", "--limit", "30"],
        cwd: getWorkspaceRoot() || null,
        timeout_secs: 15,
      }),
      16000,
      "gh issue list"
    );
    if (out.exit_code !== 0) {
      const msg = out.stderr.trim() || out.stdout.trim() || "Failed to list issues";
      return { kind: "error", message: msg };
    }
    try {
      const issues = JSON.parse(out.stdout) as GhIssue[];
      return { kind: "ok", issues };
    } catch {
      return { kind: "error", message: "Invalid response from gh CLI" };
    }
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
