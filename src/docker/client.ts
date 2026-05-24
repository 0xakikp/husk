import { invoke } from "@tauri-apps/api/core";
import { shq } from "../lib/shellQuote";

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
};

export type DockerImage = {
  id: string;
  repo: string;
  tag: string;
  size: string;
  created: string;
};

type ShellOutput = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
};

async function shell(cmd: string): Promise<string> {
  const out = await invoke<ShellOutput>("shell_run_command", {
    command: cmd,
    cwd: null,
    timeout_secs: 15,
  });
  if (out.exit_code !== 0) throw new Error(out.stderr || `exit ${out.exit_code ?? "?"}`);
  return out.stdout;
}

export async function checkDocker(): Promise<boolean> {
  try {
    await shell("docker --version");
    return true;
  } catch {
    return false;
  }
}

export async function listContainers(): Promise<DockerContainer[]> {
  const stdout = await shell(
    "docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}\t{{.Ports}}'",
  );
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split("\t");
      return {
        id: p[0] ?? "",
        name: p[1] ?? "",
        image: p[2] ?? "",
        status: p[3] ?? "",
        state: p[4] ?? "unknown",
        ports: p[5] ?? "",
      };
    });
}

export async function listImages(): Promise<DockerImage[]> {
  const stdout = await shell(
    "docker images --format '{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}'",
  );
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split("\t");
      return { id: p[0] ?? "", repo: p[1] ?? "", tag: p[2] ?? "", size: p[3] ?? "", created: p[4] ?? "" };
    });
}

export const startContainer = (id: string) => shell(`docker start ${shq(id)}`);
export const stopContainer = (id: string) => shell(`docker stop ${shq(id)}`);
export const removeContainer = (id: string) => shell(`docker rm ${shq(id)}`);
