import { invoke } from "@tauri-apps/api/core";
import { shq } from "../lib/shellQuote";

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  created?: string;
  command?: string;
  networks?: string;
  mounts?: string;
};

export type DockerContainerDetail = {
  id: string;
  name: string;
  image: string;
  imageId: string;
  state: string;
  status: string;
  created: string;
  started: string;
  finished: string;
  command: string;
  entrypoint: string;
  env: string[];
  labels: Record<string, string>;
  ports: string[];
  mounts: string[];
  networks: string[];
  ip: string;
  restartPolicy: string;
  health?: string;
  logs: string;
  inspect: string;
  stats?: DockerContainerStats;
};

export type DockerContainerStats = {
  cpuPercent: string;
  memUsage: string;
  memLimit: string;
  memPercent: string;
  netIo: string;
  blockIo: string;
  pids: string;
};

export type DockerImage = {
  id: string;
  repo: string;
  tag: string;
  size: string;
  created: string;
};

export type DockerImageDetail = {
  id: string;
  repo: string;
  tag: string;
  size: string;
  created: string;
  digest: string;
  architecture: string;
  os: string;
  command: string;
  entrypoint: string;
  env: string[];
  labels: Record<string, string>;
  layers: string[];
  history: { command: string; size: string; created: string }[];
  inspect: string;
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

export async function describeContainer(id: string): Promise<DockerContainerDetail> {
  const [json, logs] = await Promise.all([
    shell(`docker inspect ${shq(id)} --format '{{json .}}'`),
    shell(`docker logs --tail 200 ${shq(id)}`).catch(() => ""),
  ]);
  const c = JSON.parse(json);
  const config = c.Config || {};
  const state = c.State || {};
  const hostConfig = c.HostConfig || {};
  const networkSettings = c.NetworkSettings || {};
  const networks = networkSettings.Networks || {};

  const ports: string[] = [];
  const exposed = config.ExposedPorts || {};
  const bindings = hostConfig.PortBindings || {};
  for (const port of Object.keys(exposed)) {
    const bound = bindings[port] || [];
    if (bound.length) {
      ports.push(`${bound.map((b: any) => `${b.HostIp}:${b.HostPort}`).join(", ")} → ${port}`);
    } else {
      ports.push(port);
    }
  }

  const mounts: string[] = (c.Mounts || []).map((m: any) => {
    const source = m.Source || m.Name || "-";
    return `${source} → ${m.Destination}${m.Type ? ` (${m.Type})` : ""}`;
  });

  return {
    id: c.Id || id,
    name: (c.Name || "").replace(/^\//, ""),
    image: config.Image || "-",
    imageId: c.Image || "-",
    state: state.Status || "unknown",
    status: state.Status || "unknown",
    created: c.Created || "",
    started: state.StartedAt || "",
    finished: state.FinishedAt || "",
    command: (config.Cmd || []).join(" ") || "-",
    entrypoint: (config.Entrypoint || []).join(" ") || "-",
    env: config.Env || [],
    labels: config.Labels || {},
    ports,
    mounts,
    networks: Object.keys(networks),
    ip: networkSettings.IPAddress || "-",
    restartPolicy: hostConfig.RestartPolicy?.Name || "-",
    health: state.Health?.Status,
    logs,
    inspect: JSON.stringify(c, null, 2),
  };
}

export async function getContainerStats(id: string): Promise<DockerContainerStats | null> {
  const out = await shell(`docker stats --no-stream --format '{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}\t{{.PIDs}}' ${shq(id)}`).catch(() => "");
  if (!out.trim()) return null;
  const p = out.trim().split("\t");
  return {
    cpuPercent: p[0] || "-",
    memUsage: p[1] || "-",
    memLimit: p[1] ? p[1].split(" / ")[1] || "-" : "-",
    memPercent: p[2] || "-",
    netIo: p[3] || "-",
    blockIo: p[4] || "-",
    pids: p[5] || "-",
  };
}

export async function describeImage(id: string): Promise<DockerImageDetail> {
  const [json, history] = await Promise.all([
    shell(`docker inspect ${shq(id)} --format '{{json .}}'`),
    shell(`docker history --format '{{.CreatedBy}}\t{{.Size}}\t{{.CreatedAt}}' --no-trunc ${shq(id)}`).catch(() => ""),
  ]);
  const im = JSON.parse(json);
  const config = im.Config || {};
  const rootfs = im.RootFS || {};

  return {
    id: im.Id || id,
    repo: (im.RepoTags?.[0] || "").split(":")[0] || "<none>",
    tag: (im.RepoTags?.[0] || "").split(":")[1] || "<none>",
    size: im.Size ? `${Math.round(im.Size / 1024 / 1024)}MB` : "-",
    created: im.Created || "",
    digest: im.RepoDigests?.[0] || "-",
    architecture: im.Architecture || "-",
    os: im.Os || "-",
    command: (config.Cmd || []).join(" ") || "-",
    entrypoint: (config.Entrypoint || []).join(" ") || "-",
    env: config.Env || [],
    labels: config.Labels || {},
    layers: rootfs.Layers || [],
    history: history
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const p = line.split("\t");
        return { command: p[0] || "-", size: p[1] || "-", created: p[2] || "-" };
      }),
    inspect: JSON.stringify(im, null, 2),
  };
}
