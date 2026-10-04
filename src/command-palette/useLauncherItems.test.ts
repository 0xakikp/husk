// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  root: "/alpha", indexedRoot: null as string | null,
  workspaceListeners: new Set<() => void>(), cacheListeners: new Set<(key: string) => void>(),
  clips: [] as { id: string; text: string; createdAt: number }[],
  bookmarks: [] as { id: string; type: "directory" | "file" | "command"; label: string; path?: string; command?: string; createdAt: number }[],
  accounts: [] as { id: string; issuer: string; label: string }[],
  sessions: [] as { id: string; name: string; source: string; messages: unknown[] }[],
  index: new Map(), aiEnabled: true,
}));
vi.mock("../workspace/store", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    getWorkspaceRoot: () => fixture.root,
    useWorkspaceRoot: () => useSyncExternalStore((listener) => {
      fixture.workspaceListeners.add(listener);
      return () => { fixture.workspaceListeners.delete(listener); };
    }, () => fixture.root),
  };
});
vi.mock("./sources", () => ({
  loadNoteEntries: vi.fn(async () => []), loadDockerContainers: vi.fn(async () => []),
  loadK8sContexts: vi.fn(async () => []), loadWorkflowEntries: vi.fn(() => []),
  loadRunningJobs: vi.fn(async () => []), loadSshHosts: vi.fn(async () => []),
  loadWorkspaceFiles: vi.fn(async () => []),
  searchWorkspaceContents: vi.fn(async () => ({ results: [], missingTool: false })),
  workspaceFilesCacheKey: (root: string) => `ws-files:${root}`,
  subscribeLauncherCache: (listener: (key: string) => void) => {
    fixture.cacheListeners.add(listener);
    return () => { fixture.cacheListeners.delete(listener); };
  },
}));
vi.mock("../ai/codebaseSearch", () => ({
  buildCodebaseIndex: vi.fn(async () => fixture.index),
  getCodebaseIndex: () => fixture.index,
  getIndexedRoot: () => fixture.indexedRoot,
  searchCodebase: vi.fn(() => []),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }));
vi.mock("../jobs/client", () => ({ bgKill: vi.fn(async () => {}) }));
vi.mock("../notes/store", () => ({ removeRecentNote: vi.fn() }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("../ai/sessionStore", () => ({ getAllSessions: () => fixture.sessions, deleteSession: vi.fn() }));
vi.mock("../settings/wallpapers", () => ({
  BUILT_IN_WALLPAPERS: [], builtInWallpaperPath: vi.fn(), listWallpapers: vi.fn(async () => []),
  wallpaperName: vi.fn(), applyWallpaper: vi.fn(),
}));
vi.mock("../settings/preferences", () => ({ getPrefs: () => ({ aiEnabled: fixture.aiEnabled, background: { dir: "", path: "" } }) }));
vi.mock("../totp/store", () => ({ loadAccounts: () => fixture.accounts }));
vi.mock("../totp/totp", () => ({ generateCode: vi.fn(() => ({ code: "123456", remaining: 20 })) }));
vi.mock("../clipboard/store", () => ({ useClipHistory: () => fixture.clips, deleteClip: vi.fn() }));
vi.mock("../bookmarks/store", () => ({
  useBookmarks: () => fixture.bookmarks, addBookmark: vi.fn(), removeBookmark: vi.fn(), toggleBookmarkPin: vi.fn(),
}));
vi.mock("../ai/assist", () => ({ explainCommandPrompt: vi.fn(), looksLikeCommand: () => false }));

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { bgKill } from "../jobs/client";
import { toast } from "../toast";
import { shq } from "../lib/shellQuote";
import { buildCodebaseIndex, searchCodebase } from "../ai/codebaseSearch";
import {
  loadWorkspaceFiles, searchWorkspaceContents, loadDockerContainers, loadK8sContexts,
  loadRunningJobs, loadSshHosts,
} from "./sources";
import { useLauncherItems, type LauncherCtx } from "./useLauncherItems";
import type { Command } from "./CommandPalette";

let root: Root;
let container: HTMLDivElement;
let items: Command[];
let ctx: LauncherCtx;
const commands: Command[] = [{ id: "test-command", label: "Test", run: vi.fn() }];
function Harness({ open, query }: { open: boolean; query: string }) {
  items = useLauncherItems(open, query, commands, ctx);
  return null;
}
async function render(query = "", open = true) {
  await act(async () => root.render(createElement(Harness, { query, open })));
}
async function advance(ms = 151) { await act(async () => vi.advanceTimersByTimeAsync(ms)); }
async function switchRoot(path: string) {
  await act(async () => { fixture.root = path; for (const listener of fixture.workspaceListeners) listener(); });
}
function item(id: string): Command { const match = items.find((entry) => entry.id === id); expect(match, id).toBeDefined(); return match!; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function file(path: string) { return { path, rel: path.split("/").pop()!, name: path.split("/").pop()! }; }

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.root = "/alpha"; fixture.indexedRoot = null; fixture.index = new Map(); fixture.aiEnabled = true;
  fixture.clips = []; fixture.bookmarks = []; fixture.accounts = []; fixture.sessions = [];
  fixture.workspaceListeners.clear(); fixture.cacheListeners.clear();
  vi.mocked(loadWorkspaceFiles).mockReset().mockResolvedValue([]);
  vi.mocked(searchWorkspaceContents).mockReset().mockResolvedValue({ results: [], missingTool: false });
  vi.mocked(buildCodebaseIndex).mockReset().mockResolvedValue(fixture.index);
  vi.mocked(searchCodebase).mockReset().mockReturnValue([]);
  vi.mocked(writeText).mockReset().mockResolvedValue(undefined);
  vi.mocked(bgKill).mockReset().mockResolvedValue(undefined);
  vi.mocked(loadDockerContainers).mockReset().mockResolvedValue([]);
  vi.mocked(loadK8sContexts).mockReset().mockResolvedValue([]);
  vi.mocked(loadRunningJobs).mockReset().mockResolvedValue([]);
  vi.mocked(loadSshHosts).mockReset().mockResolvedValue([]);
  ctx = {
    openNote: vi.fn(), pinNote: vi.fn(), unpinNote: vi.fn(), openFile: vi.fn(), openFileAtLine: vi.fn(),
    typeInTerminal: vi.fn(async () => {}), terminalTargetLabel: "Local shell · /alpha",
    openDocker: vi.fn(), openK8s: vi.fn(), switchK8sContext: vi.fn(), runWorkflow: vi.fn(),
    openWorkflows: vi.fn(), openJobs: vi.fn(), connectRemote: vi.fn(), openBookmarks: vi.fn(),
    askAi: vi.fn(), selectAiSession: vi.fn(), setQuery: vi.fn(), openFiles: [],
  };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

it("keeps the expensive base rows reference-stable on ordinary and scoped keystrokes", async () => {
  vi.mocked(loadWorkspaceFiles).mockResolvedValue([file("/alpha/main.ts")]);
  await render("m"); const main = item("file:/alpha/main.ts"); const command = item("test-command");
  await render("main");
  expect(item("file:/alpha/main.ts")).toBe(main); expect(item("test-command")).toBe(command);
  await render("f: main");
  expect(item("file:/alpha/main.ts")).toBe(main);
  expect(buildCodebaseIndex).not.toHaveBeenCalled(); expect(loadWorkspaceFiles).toHaveBeenCalledTimes(1);
});

it("immediately hides old workspace files, discards late loads, and accepts live refresh notifications", async () => {
  const pending = deferred<ReturnType<typeof file>[]>();
  vi.mocked(loadWorkspaceFiles).mockImplementation((path) => path === "/alpha" ? pending.promise : Promise.resolve([file("/beta/beta.ts")]));
  await render(); await switchRoot("/beta");
  expect(item("file:/beta/beta.ts").detail).toBe("/beta/beta.ts");
  await act(async () => pending.resolve([file("/alpha/late.ts")]));
  expect(items.some((entry) => entry.id === "file:/alpha/late.ts")).toBe(false);
  vi.mocked(loadWorkspaceFiles).mockResolvedValue([file("/beta/new.ts")]);
  await act(async () => { for (const listener of fixture.cacheListeners) listener("ws-files:/beta"); });
  expect(item("file:/beta/new.ts").detail).toBe("/beta/new.ts");
  expect(items.some((entry) => entry.id === "file:/beta/beta.ts")).toBe(false);
  await switchRoot(""); expect(items.some((entry) => entry.kind === "file")).toBe(false);
});

it("shares one code scan across queries and resolves ranked results against its immutable root snapshot", async () => {
  const scan = deferred<Awaited<ReturnType<typeof buildCodebaseIndex>>>();
  vi.mocked(buildCodebaseIndex).mockReturnValueOnce(scan.promise);
  vi.mocked(searchCodebase).mockReturnValue([{ path: "src/parser.ts", score: 9, snippet: "parsePod", matches: [{ line: 12, text: "parsePod(value)" }] }]);
  await render("code: pod"); await render("code: pod name parsing");
  expect(buildCodebaseIndex).toHaveBeenCalledTimes(1);
  const signal = vi.mocked(buildCodebaseIndex).mock.calls[0][1]!.signal!;
  expect(signal.aborted).toBe(false);
  await act(async () => scan.resolve(fixture.index)); await advance();
  expect(searchCodebase).toHaveBeenCalledWith("pod name parsing", 30, fixture.index);
  const result = item("code:/alpha/src/parser.ts");
  expect(result.alwaysShow).toBe(true); expect(result.detail).toContain("/alpha/src/parser.ts:12");
  expect(result.searchScore).toBe(9);
  await switchRoot("/beta");
  expect(signal.aborted).toBe(true); expect(items.some((entry) => entry.id === result.id)).toBe(false);
  await result.run();
  expect(ctx.openFileAtLine).toHaveBeenCalledWith("/alpha/src/parser.ts", "parser.ts", 12);
});

it("cancels old code scans and ignores their late completion after switching roots or closing", async () => {
  const old = deferred<Awaited<ReturnType<typeof buildCodebaseIndex>>>();
  const current = deferred<Awaited<ReturnType<typeof buildCodebaseIndex>>>();
  vi.mocked(buildCodebaseIndex).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  await render("code: symbol"); const signal = vi.mocked(buildCodebaseIndex).mock.calls[0][1]!.signal!;
  await switchRoot("/beta"); expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(new Map())); await advance();
  expect(searchCodebase).not.toHaveBeenCalled();
  await render("code: symbol", false);
  expect(vi.mocked(buildCodebaseIndex).mock.calls[1][1]!.signal!.aborted).toBe(true);
  await act(async () => current.resolve(new Map())); await advance();
  expect(searchCodebase).not.toHaveBeenCalled();
});

it("runs grep against the captured workspace and drops late results from the previous workspace", async () => {
  const old = deferred<Awaited<ReturnType<typeof searchWorkspaceContents>>>();
  vi.mocked(searchWorkspaceContents).mockReturnValueOnce(old.promise).mockResolvedValue({
    results: [{ path: "/beta/found.ts", rel: "found.ts", line: 2, text: "needle" }], missingTool: false,
  });
  await render("g: needle"); await advance(); await switchRoot("/beta"); await advance();
  expect(searchWorkspaceContents).toHaveBeenLastCalledWith("needle", 50, "/beta");
  await act(async () => old.resolve({ results: [{ path: "/alpha/old.ts", rel: "old.ts", line: 1, text: "needle" }], missingTool: false }));
  expect(items.some((entry) => entry.id === "grep:/alpha/old.ts:1")).toBe(false);
  expect(item("grep:/beta/found.ts:2").alwaysShow).toBe(true);
});

it("quotes generated terminal arguments and adds exact-text target confirmations to every staging route", async () => {
  const path = "/alpha/weird '$(literal)'/file.ts";
  const name = "name';$(literal)";
  vi.mocked(loadWorkspaceFiles).mockResolvedValue([file(path)]);
  vi.mocked(loadDockerContainers).mockResolvedValue([{ id: "container", name, image: "test", state: "running", status: "Up", ports: "" }]);
  vi.mocked(loadK8sContexts).mockResolvedValue([{ name, current: true }]);
  vi.mocked(loadSshHosts).mockResolvedValue([name]);
  fixture.bookmarks = [{ id: "directory", type: "directory", label: "Directory", path, createdAt: 0 }];
  await render();
  const actions = [
    ...item(`file:${path}`).actions!.filter((action) => action.confirmation),
    ...item("docker:container").actions!,
    ...item(`k8s:${name}`).actions!.filter((action) => action.confirmation),
    ...item(`remote:${name}`).actions!.filter((action) => action.confirmation),
    item("bookmark:directory"),
  ];
  const texts = [
    shq(path), `cd ${shq(path.replace(/\/[^/]*$/, ""))}`,
    `docker logs -f ${shq(name)}`, `docker exec -it ${shq(name)} sh`, `docker restart ${shq(name)}`,
    `kubectl config use-context ${shq(name)}`, `ssh ${shq(name)}`, `cd ${shq(path)}`,
  ];
  expect(ctx.typeInTerminal).not.toHaveBeenCalled();
  for (const [index, action] of actions.entries()) {
    expect(action.confirmation?.description).toContain(texts[index]);
    expect(action.confirmation?.description).toContain(ctx.terminalTargetLabel);
    expect(action.confirmation?.confirmLabel).toBe("Stage command");
    await action.run();
    expect(ctx.typeInTerminal).toHaveBeenLastCalledWith(texts[index]);
  }
});

it("never normalizes multiline clipboard text into a command and keeps exact copying available", async () => {
  const text = "echo first\nwhoami\u001b[31m";
  fixture.clips = [{ id: "unsafe", text, createdAt: 0 }];
  await render(); const clip = item("clip:unsafe");
  expect(clip.primaryLabel).toBe("Copy text"); expect(clip.confirmation).toBeUndefined();
  await clip.run(); expect(ctx.typeInTerminal).not.toHaveBeenCalled();
  await clip.secondary!.run(); expect(writeText).toHaveBeenCalledWith(text);
});

it("requires destructive-action confirmation and propagates native failures", async () => {
  fixture.sessions = [{ id: "chat", name: "Important chat", source: "codex", messages: ["hello"] }];
  vi.mocked(loadRunningJobs).mockResolvedValue([{ handle: 42, command: "worker", cwd: "/alpha", started_at_ms: 0, exited: false, exit_code: null }]);
  await render();
  const kill = item("job:42").actions!.find((action) => action.label === "Kill job")!;
  expect(kill.confirmation?.description).toContain("worker");
  expect(item("session:chat").actions!.find((action) => action.label === "Delete chat")!.confirmation?.description).toContain("Important chat");
  vi.mocked(bgKill).mockRejectedValueOnce(new Error("kill denied"));
  await expect(kill.run()).rejects.toThrow("kill denied");
});

it("awaits native 2FA copying and never places the code in a toast", async () => {
  fixture.accounts = [{ id: "account", issuer: "Fixture", label: "test" }];
  await render();
  await item("totp:account").run();
  expect(writeText).toHaveBeenCalledWith("123456");
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Code copied" }));
  expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain("123456");
  vi.mocked(toast).mockClear(); vi.mocked(writeText).mockRejectedValueOnce(new Error("clipboard denied"));
  await expect(item("totp:account").run()).rejects.toThrow("clipboard denied");
  expect(toast).not.toHaveBeenCalled();
});

it("preserves remote provenance for open files without hiding same-path local workspace files", async () => {
  ctx.openFiles = [{ path: "/alpha/main.ts", name: "main.ts", remoteHost: "fixture-host" }];
  vi.mocked(loadWorkspaceFiles).mockResolvedValue([file("/alpha/main.ts")]);
  await render();
  const remote = item("file-open:fixture-host:/alpha/main.ts");
  expect(remote.detail).toBe("fixture-host:/alpha/main.ts"); await remote.run();
  expect(ctx.openFile).toHaveBeenCalledWith("/alpha/main.ts", "main.ts", "fixture-host");
  await item("file:/alpha/main.ts").run();
  expect(ctx.openFile).toHaveBeenLastCalledWith("/alpha/main.ts", "main.ts");
});

it("keeps oversized clipboard entries copy-only and honors disabled AI preferences", async () => {
  fixture.aiEnabled = false;
  fixture.clips = [{ id: "large", text: "x".repeat(2_001), createdAt: 0 }];
  await render("search this");
  expect(items.some((entry) => entry.kind === "ai")).toBe(false);
  const clip = item("clip:large"); expect(clip.primaryLabel).toBe("Copy text");
  expect(clip.confirmation).toBeUndefined(); await clip.run();
  expect(ctx.typeInTerminal).not.toHaveBeenCalled(); expect(writeText).toHaveBeenCalledWith(fixture.clips[0].text);
});
