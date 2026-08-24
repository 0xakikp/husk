import type { LauncherKind } from "./CommandPalette";

/* Colon-terminated scopes cannot hijack ordinary text. Long aliases make the
   feature discoverable without requiring users to memorise one-letter forms. */
const SCOPE_TOKENS: Record<string, LauncherKind> = {
  cmd: "command", command: "command", commands: "command",
  n: "note", note: "note", notes: "note",
  f: "file", file: "file", files: "file",
  g: "grep", grep: "grep", content: "grep", contents: "grep",
  code: "code", cs: "code", sym: "code", symbol: "code",
  c: "clipboard", clip: "clipboard", clipboard: "clipboard",
  b: "bookmark", bm: "bookmark", bookmark: "bookmark", bookmarks: "bookmark",
  w: "workflow", wf: "workflow", workflow: "workflow", workflows: "workflow",
  d: "container", docker: "container", container: "container", containers: "container",
  k: "k8s", k8s: "k8s", kube: "k8s", kubernetes: "k8s",
  r: "remote", remote: "remote", remotes: "remote", ssh: "remote",
  j: "job", job: "job", jobs: "job",
  otp: "totp", totp: "totp", "2fa": "totp", auth: "totp", mfa: "totp",
  chat: "session", chats: "session", session: "session", sessions: "session",
  wall: "wallpaper", wallpaper: "wallpaper", wallpapers: "wallpaper", bg: "wallpaper",
};

const SCOPE_CANONICAL: Partial<Record<LauncherKind, string>> = {
  command: "cmd",
  note: "notes",
  file: "files",
  grep: "grep",
  code: "code",
  clipboard: "clip",
  bookmark: "bookmarks",
  workflow: "workflows",
  container: "docker",
  k8s: "k8s",
  remote: "remotes",
  job: "jobs",
  totp: "otp",
  session: "chats",
  wallpaper: "wall",
};

const SCOPE_LABELS: Partial<Record<LauncherKind, string>> = {
  command: "command",
  note: "notes",
  file: "files",
  grep: "grep",
  code: "code",
  clipboard: "clipboard",
  bookmark: "bookmarks",
  workflow: "workflows",
  container: "docker",
  k8s: "kubernetes",
  remote: "remotes",
  job: "jobs",
  totp: "2fa",
  session: "chats",
  wallpaper: "wallpaper",
};

export function matchScopeTokens(raw: string): { token: string; kind: LauncherKind }[] {
  const query = raw.trim().toLowerCase();
  if (query.length < 2) return [];
  const seen = new Set<LauncherKind>();
  const matches: { token: string; kind: LauncherKind }[] = [];
  for (const [alias, kind] of Object.entries(SCOPE_TOKENS)) {
    if (seen.has(kind)) continue;
    if (alias.startsWith(query) || SCOPE_LABELS[kind]?.startsWith(query)) {
      seen.add(kind);
      matches.push({ token: SCOPE_CANONICAL[kind] ?? alias, kind });
    }
  }
  return matches;
}

export function parseQuery(raw: string): { kind: LauncherKind | null; query: string } {
  if (raw.startsWith(">")) return { kind: "command", query: raw.slice(1).trimStart() };
  // Keep URLs and Windows-like paths as queries, not scopes.
  const match = raw.match(/^([A-Za-z0-9]{1,10}):(?![/\\])\s*([\s\S]*)$/);
  if (match) {
    const kind = SCOPE_TOKENS[match[1].toLowerCase()];
    if (kind) return { kind, query: match[2] };
  }
  return { kind: null, query: raw };
}
