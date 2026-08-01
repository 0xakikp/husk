import { readDir, readFile } from "../fs";

export type ProjectAction = { label: string; command: string };

/** Lockfile → package manager, most specific first. */
const JS_MANAGERS: [string, string][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/** Which package scripts are worth a one-click pill, in order of usefulness. */
const SCRIPT_PRIORITY = ["dev", "start", "serve", "test", "build", "check", "lint", "typecheck"];

function scriptCommand(manager: string, script: string): string {
  // pnpm and yarn accept a bare script name; npm and bun need an explicit `run`.
  if (manager === "npm") return `npm run ${script}`;
  if (manager === "bun") return `bun run ${script}`;
  return `${manager} ${script}`;
}

async function nodeActions(cwd: string, names: Set<string>): Promise<ProjectAction[]> {
  const manager = JS_MANAGERS.find(([lock]) => names.has(lock))?.[1] ?? "npm";
  let scripts: Record<string, string> = {};
  try {
    const parsed = JSON.parse(await readFile(`${cwd}/package.json`));
    if (parsed && typeof parsed.scripts === "object") scripts = parsed.scripts;
  } catch {
    // Unreadable or malformed package.json — fall back to install, which is
    // valid for every manager.
    return [{ label: "install", command: `${manager} install` }];
  }
  const picked = SCRIPT_PRIORITY.filter((s) => s in scripts);
  if (picked.length === 0) return [{ label: "install", command: `${manager} install` }];
  return picked.map((s) => ({ label: s, command: scriptCommand(manager, s) }));
}

/**
 * Actions that suit the directory the terminal is actually standing in.
 *
 * The bottom bar's idle state used to offer `clear` and `ls -la`, which are the
 * same everywhere and so tell you nothing. Reading the cwd lets it offer the
 * commands you would actually reach for in this project.
 *
 * Only non-destructive commands are surfaced — these fire on a single click with
 * no confirmation, so nothing here may delete, prune, reset or force anything.
 */
export async function detectProjectActions(cwd: string): Promise<ProjectAction[]> {
  if (!cwd) return [];
  let names: Set<string>;
  try {
    names = new Set((await readDir(cwd)).map((e) => e.name));
  } catch {
    return [];
  }

  const actions: ProjectAction[] = [];

  if (names.has("package.json")) actions.push(...(await nodeActions(cwd, names)));

  if (names.has("Cargo.toml")) {
    actions.push({ label: "cargo run", command: "cargo run" });
    actions.push({ label: "cargo test", command: "cargo test" });
  }

  if (names.has("go.mod")) {
    actions.push({ label: "go run", command: "go run ." });
    actions.push({ label: "go test", command: "go test ./..." });
  }

  if (
    names.has("docker-compose.yml") ||
    names.has("docker-compose.yaml") ||
    names.has("compose.yml") ||
    names.has("compose.yaml")
  ) {
    actions.push({ label: "compose up", command: "docker compose up -d" });
    actions.push({ label: "compose ps", command: "docker compose ps" });
  }

  if (names.has("Makefile") || names.has("makefile")) {
    actions.push({ label: "make", command: "make" });
  }

  if (names.has("pyproject.toml")) {
    actions.push({ label: "pytest", command: "pytest" });
  } else if (names.has("requirements.txt")) {
    actions.push({ label: "pip install", command: "pip install -r requirements.txt" });
  }

  /* Four fits comfortably: the widest label ("pip install") is ~101px, so four
     pills plus gaps come to ~420px against roughly 1190px of free space between
     the exit-code cluster and the vitals strip. */
  return actions.slice(0, 4);
}

/* Detection is a directory read per cwd, so cache it. Terminals change directory
   far more often than a project gains a Cargo.toml. */
const cache = new Map<string, { at: number; actions: ProjectAction[] }>();
const TTL_MS = 30_000;

export async function cachedProjectActions(cwd: string): Promise<ProjectAction[]> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.actions;
  const actions = await detectProjectActions(cwd);
  cache.set(cwd, { at: Date.now(), actions });
  return actions;
}
