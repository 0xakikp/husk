// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  workspace: "/repo", cwd: "/elsewhere", remote: { isRemote: false, host: undefined as string | undefined }, prefs: { showHidden: false },
  read: vi.fn(), home: vi.fn(), createFile: vi.fn(), createDir: vi.fn(), copy: vi.fn(), rename: vi.fn(), trash: vi.fn(),
  sshRead: vi.fn(), sshHome: vi.fn(), sshCreate: vi.fn(), sshRename: vi.fn(), sshDelete: vi.fn(), run: vi.fn(), toast: vi.fn(), ask: vi.fn(), snapshot: vi.fn(), unsaved: vi.fn(),
}));
vi.mock("../fs", () => ({ readDir: mock.read, homeDir: mock.home, createFile: mock.createFile, createDir: mock.createDir, copyPath: mock.copy, renamePath: mock.rename, trashPath: mock.trash }));
vi.mock("../remote/remoteFs", () => ({ sshReadDir: mock.sshRead, sshHomeDir: mock.sshHome, sshCreateFile: mock.sshCreate, sshCreateDir: mock.sshCreate, sshCopyPath: mock.copy, sshRenamePath: mock.sshRename, sshDeletePath: mock.sshDelete }));
vi.mock("../workspace/store", () => ({ useWorkspaceRoot: () => mock.workspace }));
vi.mock("../ai/terminalContext", () => ({ useActiveTerminalCwd: () => mock.cwd, useActiveRemoteTerminal: () => mock.remote, getActiveRemoteTerminal: () => mock.remote, runInActiveTerminalResult: mock.run }));
vi.mock("../settings/preferences", () => ({ usePrefs: () => mock.prefs, setPrefs: (patch: Partial<typeof mock.prefs>) => Object.assign(mock.prefs, patch) }));
vi.mock("../editor/dirtyStore", () => ({ getFileState: () => "clean", getUnsavedPathWithin: mock.unsaved, subscribeDirty: () => () => {} }));
vi.mock("../git/client", () => ({ repositorySnapshot: mock.snapshot }));
vi.mock("../toast", () => ({ toast: mock.toast }));
vi.mock("../remote/store", () => ({ setActiveSshHost: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: mock.ask }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./iconResolver", () => ({ fileIconUrl: () => "/test-file.svg", folderIconUrl: () => "/test-folder.svg" }));
vi.mock("./FilesSearch", () => ({ FilesSearch: ({ root, active }: { root: string; active: boolean }) => <div>Recursive search: {root} · {String(active)}</div> }));
import { FileExplorer } from "./FileExplorer";
import { onFileChanged, onRepositoryFilesChanged } from "../editor/fileChanges";
const entry = (path: string, is_dir = false) => ({ path, name: path.split("/").pop()!, is_dir });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
let host: HTMLDivElement; let root: Root;
let props: Partial<ComponentProps<typeof FileExplorer>>;
const onOpen = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks();
  mock.workspace = "/repo"; mock.cwd = "/elsewhere"; mock.remote = { isRemote: false, host: undefined }; mock.prefs.showHidden = false;
  mock.read.mockReset().mockImplementation(async (path: string) => path === "/repo" ? [entry("/repo/src", true), entry("/repo/.env"), entry("/repo/readme.md")] : path === "/repo/src" ? [entry("/repo/src/app.ts")] : []);
  mock.home.mockReset().mockResolvedValue("/home/local"); mock.snapshot.mockReset().mockResolvedValue(null); mock.unsaved.mockReset().mockReturnValue(null);
  mock.sshHome.mockReset().mockImplementation(async (name: string) => `/home/${name}`); mock.sshRead.mockReset().mockResolvedValue([]);
  for (const fn of [mock.createFile, mock.createDir, mock.rename, mock.copy, mock.trash, mock.sshDelete, mock.sshCreate, mock.sshRename]) fn.mockReset().mockResolvedValue(undefined);
  mock.ask.mockReset().mockResolvedValue(true); mock.run.mockReset().mockReturnValue({ ok: true }); onOpen.mockReset(); props = {};
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const render = async (next: Partial<ComponentProps<typeof FileExplorer>> = {}) => { props = { ...props, ...next }; await act(async () => root.render(<FileExplorer onOpenFile={onOpen} {...props} />)); };
const button = (label: string) => [...document.querySelectorAll<HTMLElement>('button,[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]')].find((node) => node.getAttribute("aria-label") === label || node.textContent?.trim() === label)!;
const click = async (label: string) => { const node = button(label); expect(node, label).toBeDefined(); await act(async () => node.click()); };
const row = (path: string) => [...host.querySelectorAll<HTMLButtonElement>("[data-explorer-node]")].find((node) => node.dataset.explorerNode === path)!;
const key = async (node: Element, key: string, patch: KeyboardEventInit = {}) => { await act(async () => node.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, ...patch }))); };
const input = async (node: HTMLInputElement, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); };
const context = async (path: string) => { await act(async () => row(path).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 40 }))); };
const settleMenuFocus = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const options = async () => {
  await settleMenuFocus(); await act(async () => button("Files options").focus());
  await key(button("Files options"), "ArrowDown"); await settleMenuFocus();
};
const option = async (label: string) => { await options(); await click(label); await settleMenuFocus(); };

it("defaults to the workspace, exposes hidden files and can follow a local terminal", async () => {
  await render(); expect(mock.read).toHaveBeenCalledWith("/repo"); expect(row("/repo/.env")).toBeUndefined();
  expect(host.querySelector("select")).toBeNull(); expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  expect(host.querySelector(".files-scope")?.textContent).not.toContain("Collapse all");
  expect(host.querySelector(".files-scope-kind")).toBeNull(); expect(host.querySelector(".files-scope-dot")).toBeNull();
  expect(host.querySelector(".files-scope-path")?.getAttribute("title")).toBe("Local folder: /repo");
  await option("Show hidden files"); await render();
  expect(row("/repo/.env")).toBeDefined();
  await option("Follow local terminal");
  expect(mock.read).toHaveBeenCalledWith("/elsewhere"); expect(host.querySelector(".files-scope-kind")?.textContent).toBe("Terminal");
  expect(host.querySelector(".files-scope-path")?.textContent).toBe("/elsewhere");
});

it("never uses a remote terminal cwd as a local filesystem root", async () => {
  mock.workspace = ""; mock.cwd = "/remote-only"; mock.remote = { isRemote: true, host: "prod" }; await render();
  expect(mock.read).toHaveBeenCalledWith("/home/local"); expect(mock.read).not.toHaveBeenCalledWith("/remote-only");
});

it("keeps expanded folders through refresh and exposes loading, error and retry states", async () => {
  const pending = deferred<ReturnType<typeof entry>[]>(); mock.read.mockReturnValueOnce(pending.promise); await render();
  expect(host.textContent).toContain("Loading folder…"); await act(async () => pending.resolve([entry("/repo/src", true)]));
  await act(async () => row("/repo/src").click()); expect(row("/repo/src/app.ts")).toBeDefined();
  await click("Refresh"); expect(row("/repo/src/app.ts")).toBeDefined(); expect(row("/repo/src").getAttribute("aria-expanded")).toBe("true");
  mock.read.mockRejectedValue(new Error("Permission denied")); await click("Refresh");
  expect(host.textContent).toContain("Could not refresh"); expect(host.textContent).toContain("Permission denied"); expect(host.textContent).not.toContain("This folder is empty");
  mock.read.mockResolvedValue([]); await click("Retry folder"); expect(host.textContent).toContain("This folder is empty");
});

it("refreshes for relevant file/repository changes and window focus, but not while inactive", async () => {
  vi.useFakeTimers(); await render(); mock.read.mockClear();
  await act(async () => { onFileChanged("/other/file"); vi.advanceTimersByTime(100); }); expect(mock.read).not.toHaveBeenCalled();
  await act(async () => { onFileChanged("/repo/file"); onRepositoryFilesChanged("/repo"); vi.advanceTimersByTime(100); }); expect(mock.read).toHaveBeenCalledTimes(1);
  await render({ active: false }); mock.read.mockClear(); mock.snapshot.mockClear();
  await act(async () => { window.dispatchEvent(new Event("focus")); onFileChanged("/repo/file"); vi.advanceTimersByTime(11_000); });
  expect(mock.read).not.toHaveBeenCalled(); expect(mock.snapshot).not.toHaveBeenCalled();
});

it("supports keyboard tree navigation, collapse and revealing a nested active file", async () => {
  await render({ activeFile: "/repo/src/app.ts" }); await act(async () => row("/repo/src").focus());
  await key(row("/repo/src"), "ArrowRight"); expect(row("/repo/src/app.ts")).toBeDefined();
  await key(row("/repo/src"), "ArrowDown"); expect(document.activeElement).toBe(row("/repo/src/app.ts"));
  await key(row("/repo/src/app.ts"), "ArrowLeft"); expect(document.activeElement).toBe(row("/repo/src"));
  await key(row("/repo/src"), "End"); expect(document.activeElement).toBe(row("/repo/readme.md"));
  await key(row("/repo/readme.md"), "Home"); expect(document.activeElement).toBe(row("/repo/src"));
  await option("Collapse all"); expect(row("/repo/src/app.ts")).toBeUndefined();
  await option("Reveal active file"); expect(document.activeElement).toBe(row("/repo/src/app.ts"));
  await option("Collapse all"); expect(row("/repo/src/app.ts")).toBeUndefined();
});

it("opens a keyboard context menu and returns focus on Escape without running actions", async () => {
  await render(); await act(async () => row("/repo/readme.md").focus());
  await key(row("/repo/readme.md"), "F10", { shiftKey: true }); expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(document.activeElement?.textContent).toBe("Open"); await key(document.activeElement!, "End"); expect(document.activeElement?.textContent).toBe("Move to Trash…");
  await key(document.activeElement!, "Escape"); expect(document.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement).toBe(row("/repo/readme.md"));
  expect(mock.trash).not.toHaveBeenCalled(); expect(onOpen).not.toHaveBeenCalled();
});

it("validates rename basenames and supports F2 without writing on invalid input", async () => {
  await render(); await key(row("/repo/readme.md"), "F2");
  const field = host.querySelector<HTMLInputElement>('[aria-label="Rename item"]')!;
  await input(field, "../outside"); await key(field, "Enter"); expect(mock.rename).not.toHaveBeenCalled(); expect(host.textContent).toContain("Use a name, not a path");
  await input(field, "renamed.md"); await key(field, "Enter"); expect(mock.rename).toHaveBeenCalledWith("/repo/readme.md", "/repo/renamed.md");
});

it("preserves intentional spaces in valid names rather than silently trimming them", async () => {
  await render(); await key(row("/repo/readme.md"), "F2");
  const field = host.querySelector<HTMLInputElement>('[aria-label="Rename item"]')!;
  await input(field, " spaced name.md "); await key(field, "Enter");
  expect(mock.rename).toHaveBeenCalledWith("/repo/readme.md", "/repo/ spaced name.md ");
});

it("uses local Trash only after confirmation and protects unsaved files", async () => {
  await render(); mock.unsaved.mockReturnValue("/repo/readme.md"); await context("/repo/readme.md"); await click("Move to Trash…");
  expect(mock.ask).toHaveBeenCalledWith(expect.stringContaining("restore it using your system Trash"), expect.anything()); expect(mock.trash).not.toHaveBeenCalled();
  mock.unsaved.mockReturnValue(null); await context("/repo/readme.md"); await click("Move to Trash…"); expect(mock.trash).toHaveBeenCalledWith("/repo/readme.md"); expect(mock.sshDelete).not.toHaveBeenCalled();
});

it("does not delete after the Files scope changes during confirmation", async () => {
  await render(); const answer = deferred<boolean>(); mock.ask.mockReturnValue(answer.promise); await context("/repo/readme.md"); await click("Move to Trash…");
  mock.workspace = "/new"; await render(); await act(async () => answer.resolve(true)); expect(mock.trash).not.toHaveBeenCalled();
});

it("rejects mismatched terminal hosts and reports idle-prompt refusals", async () => {
  await render(); mock.remote = { isRemote: true, host: "prod" }; await context("/repo/src"); await click("Use folder in active terminal"); expect(mock.run).not.toHaveBeenCalled();
  mock.remote = { isRemote: false, host: undefined }; mock.run.mockReturnValue({ ok: false, reason: "input-present", message: "Clear the prompt first" });
  await context("/repo/src"); await click("Use folder in active terminal"); expect(mock.run).toHaveBeenCalledWith("cd '/repo/src'");
  expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Clear the prompt first" }));
});

it("binds remote home requests to the host and never displays a late previous-host result", async () => {
  const first = deferred<string>(); mock.sshHome.mockImplementation((name: string) => name === "one" ? first.promise : Promise.resolve("/home/two"));
  await render({ remoteHost: "one" }); expect(host.textContent).toContain("Loading Files"); await render({ remoteHost: "two" });
  expect(mock.sshRead).toHaveBeenCalledWith("two", "/home/two"); await act(async () => first.resolve("/home/one"));
  expect(host.querySelector(".files-scope-kind")?.textContent).toBe("SSH");
  expect(host.querySelector(".files-scope-path")?.textContent).toBe("two:/home/two"); expect(mock.sshRead).not.toHaveBeenCalledWith("two", "/home/one");
});

it("makes remote permanent deletion and local-only search scope explicit", async () => {
  mock.sshRead.mockResolvedValue([entry("/home/prod/log.txt")]); await render({ remoteHost: "prod" });
  await options(); expect(document.body.textContent).toContain("recursive search is local only");
  await key(document.activeElement!, "Escape"); await settleMenuFocus(); await context("/home/prod/log.txt"); await click("Delete permanently…");
  expect(mock.ask).toHaveBeenCalledWith(expect.stringContaining("cannot be undone in Husk"), expect.anything()); expect(mock.sshDelete).toHaveBeenCalledWith("prod", "/home/prod/log.txt");
});

it("keeps Files options keyboard-accessible and closes them when the sidebar is hidden", async () => {
  await render(); await options();
  expect(document.querySelector('[role="menuitemcheckbox"]')?.getAttribute("aria-checked")).toBe("false");
  expect(button("Reveal active file").getAttribute("aria-disabled")).toBe("true");
  await key(document.activeElement!, "Escape");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await options(); expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await render({ active: false }); expect(document.querySelector('[role="menu"]')).toBeNull();
  await render({ active: true }); expect(document.querySelector('[role="menu"]')).toBeNull();
});

it("unmounts recursive search when closed so its previous filter cannot hide files", async () => {
  await render(); await click("Search files and contents"); expect(host.textContent).toContain("Recursive search: /repo");
  await click("Close search and clear query"); expect(host.textContent).not.toContain("Recursive search:"); expect(row("/repo/readme.md")).toBeDefined();
});

it("locks repeated root creation and does not open its result in a newly selected workspace", async () => {
  const pending = deferred<void>(); mock.createFile.mockReturnValue(pending.promise); await render(); await click("New file");
  const field = host.querySelector<HTMLInputElement>('[aria-label="New file name"]')!; await input(field, "draft.ts");
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
  });
  expect(mock.createFile).toHaveBeenCalledTimes(1); expect(mock.createFile).toHaveBeenCalledWith("/repo/draft.ts");
  mock.workspace = "/new"; await render(); await act(async () => pending.resolve()); expect(onOpen).not.toHaveBeenCalled();
});

it("ignores a stale directory read when a newer refresh finishes first", async () => {
  const old = deferred<ReturnType<typeof entry>[]>(); mock.read.mockReturnValueOnce(old.promise); await render();
  mock.read.mockResolvedValue([entry("/repo/current.txt")]); await click("Refresh"); expect(row("/repo/current.txt")).toBeDefined();
  await act(async () => old.resolve([entry("/repo/stale.txt")]));
  expect(row("/repo/current.txt")).toBeDefined(); expect(row("/repo/stale.txt")).toBeUndefined();
});

it("only sends remote folder changes to the exact known host", async () => {
  mock.sshRead.mockResolvedValue([entry("/home/prod/project", true)]); mock.remote = { isRemote: true, host: "other" };
  await render({ remoteHost: "prod" }); await context("/home/prod/project"); await click("Use folder in active terminal"); expect(mock.run).not.toHaveBeenCalled();
  mock.remote = { isRemote: true, host: "prod" }; await context("/home/prod/project"); await click("Use folder in active terminal");
  expect(mock.run).toHaveBeenCalledExactlyOnceWith("cd '/home/prod/project'");
});

it("displays control characters explicitly and never sends such paths to a terminal", async () => {
  mock.read.mockResolvedValue([entry("/repo/line\nfolder", true)]); await render();
  expect(host.textContent).toContain("line\\u000afolder"); await context("/repo/line\nfolder"); await click("Use folder in active terminal");
  expect(mock.run).not.toHaveBeenCalled(); expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "This path contains terminal control characters" }));
});
