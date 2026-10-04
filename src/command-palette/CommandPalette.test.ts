// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));
const history = vi.hoisted(() => ({ recent: [] as string[], record: vi.fn() }));
vi.mock("./history", () => ({
  getCommandHistory: () => history.recent,
  getFrecencyScore: (id: string) => id === "old" ? 100 : 0,
  recordCommandUse: history.record,
}));
import { CommandPalette, type Command, type LauncherKind } from "./CommandPalette";

let root: Root;
let host: HTMLDivElement;
const close = vi.fn();
const queryChanged = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  history.recent = [];
  history.record.mockClear(); close.mockClear(); queryChanged.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

function Harness({ commands }: { commands: Command[] }) {
  const [query, setQuery] = useState("");
  return createElement(CommandPalette, {
    open: true, commands, inputValue: query,
    onInputChange: (value: string) => { setQuery(value); queryChanged(value); }, onClose: close,
  });
}
async function render(commands: Command[]) {
  await act(async () => { root.render(createElement(Harness, { commands })); });
  await settle();
}
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); }
function input() { return document.querySelector<HTMLInputElement>("[cmdk-input]")!; }
function items() { return [...document.querySelectorAll<HTMLElement>("[cmdk-item]")]; }
function item(label: string) { return items().find((row) => row.textContent?.includes(label))!; }
function button(label: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find((row) => row.textContent === label)!; }
function sourcesButton() { return document.querySelector<HTMLButtonElement>(".launcher-sources-toggle")!; }
async function click(element: HTMLElement) { await act(async () => element.click()); await settle(); }
async function type(value: string) {
  await act(async () => {
    const field = input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
async function key(key: string, options: KeyboardEventInit = {}, target: EventTarget = input()) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options })); });
  await settle();
}
function command(id: string, overrides: Partial<Command> = {}): Command {
  return { id, label: id, group: "General", run: vi.fn(), ...overrides };
}

it("renders Chats, Wallpaper, 2FA, and previously unknown producer groups", async () => {
  await render([
    command("Conversation", { kind: "session", group: "Chats" }),
    command("Mountain", { kind: "wallpaper", group: "Wallpaper" }),
    command("Account code", { kind: "totp", group: "2FA" }),
    command("Future result", { group: "New source" }),
  ]);
  expect(items().map((row) => row.textContent)).toEqual(["Conversation", "Mountain", "Account code", "Future result"]);
});

it("renders every source with its original coloured icon badge, including default commands", async () => {
  const colours: Record<LauncherKind, [string, string]> = {
    command: ["text-primary", "bg-primary/10"],
    note: ["text-amber-400", "bg-amber-500/10"],
    file: ["text-sky-400", "bg-sky-500/10"],
    container: ["text-blue-400", "bg-blue-500/10"],
    k8s: ["text-violet-400", "bg-violet-500/10"],
    workflow: ["text-emerald-400", "bg-emerald-500/10"],
    job: ["text-orange-400", "bg-orange-500/10"],
    remote: ["text-cyan-400", "bg-cyan-500/10"],
    clipboard: ["text-pink-400", "bg-pink-500/10"],
    bookmark: ["text-yellow-400", "bg-yellow-500/10"],
    grep: ["text-lime-400", "bg-lime-500/10"],
    code: ["text-teal-400", "bg-teal-500/10"],
    totp: ["text-rose-400", "bg-rose-500/10"],
    session: ["text-indigo-400", "bg-indigo-500/10"],
    wallpaper: ["text-purple-400", "bg-purple-500/10"],
    ai: ["text-fuchsia-400", "bg-fuchsia-500/10"],
  };
  const kinds = Object.keys(colours) as LauncherKind[];
  await render([
    ...kinds.map((kind) => command("badge-" + kind, { kind, group: kind })),
    command("default-command"),
  ]);
  for (const kind of kinds) {
    const badge = item("badge-" + kind).querySelector<HTMLElement>(".launcher-kind-icon");
    expect(badge?.tagName).toBe("SPAN");
    expect(badge?.dataset.kind).toBe(kind);
    for (const colour of colours[kind]) expect(badge?.classList.contains(colour)).toBe(true);
  }
  const defaultBadge = item("default-command").querySelector<HTMLElement>(".launcher-kind-icon");
  expect(defaultBadge?.dataset.kind).toBe("command");
  for (const colour of colours.command) expect(defaultBadge?.classList.contains(colour)).toBe(true);
});

it("names the secondary shortcut on its result row and keeps keyboard execution separate", async () => {
  const run = vi.fn(); const copy = vi.fn();
  await render([command("Saved path", { kind: "clipboard", run, secondary: { label: "Copy path", run: copy } })]);
  const shortcut = item("Saved path").querySelector('[data-slot="command-shortcut"]');
  expect(shortcut?.textContent).toMatch(/^(?:⌘|Ctrl\+)↵ Copy path$/);
  await key("Enter", { ctrlKey: true });
  expect(copy).toHaveBeenCalledOnce(); expect(run).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce(); expect(history.record).toHaveBeenCalledWith("Saved path");
});

it("shows available Recent results newest-first, independently of frequency, with no duplicates", async () => {
  history.recent = ["missing", "new", "old"];
  await render([command("old"), command("new"), command("other")]);
  const recent = [...document.querySelectorAll("[cmdk-group]")].find((group) => group.textContent?.startsWith("Recent"))!;
  expect([...recent.querySelectorAll("[cmdk-item]")].map((row) => row.textContent)).toEqual(["new", "old"]);
  expect(items().map((row) => row.textContent)).toEqual(["new", "old", "other"]);
});

it("walks history newest-first with Alt+Up, skips missing rows, and returns with Alt+Down", async () => {
  history.recent = ["missing", "new", "gone", "old"];
  await render([command("old"), command("new")]);
  await key("ArrowUp", { altKey: true }); expect(input().value).toBe("new");
  await key("ArrowUp", { altKey: true }); expect(input().value).toBe("old");
  await key("ArrowDown", { altKey: true }); expect(input().value).toBe("new");
  await key("ArrowDown", { altKey: true }); expect(input().value).toBe("");
});

it("switches clickable scope filters without losing text, including clicking the active filter", async () => {
  await render([command("config", { kind: "file", group: "Files" })]);
  expect(sourcesButton().getAttribute("aria-expanded")).toBe("false");
  await type("notes: config");
  expect(document.querySelector('[aria-label="Clear Notes filter"]')?.classList.contains("text-amber-400")).toBe(true);
  await click(sourcesButton());
  await click(button("Files")); expect(input().value).toBe("files: config");
  expect(sourcesButton().getAttribute("aria-expanded")).toBe("false");
  await click(sourcesButton());
  await click(button("Files")); expect(input().value).toBe("files: config");
  await click(sourcesButton());
  await click(button("All")); expect(input().value).toBe("config");
});

it("reaches source filters with Alt+S and never executes a result when activating a filter", async () => {
  const entry = command("config", { kind: "file", group: "Files" });
  await render([entry]); await type("config");
  await key("s", { altKey: true, code: "KeyS" });
  expect(sourcesButton().getAttribute("aria-expanded")).toBe("true");
  expect(sourcesButton().getAttribute("aria-controls")).toBe("launcher-source-filters");
  expect(document.activeElement).toBe(button("All"));
  await key("ArrowRight", {}, document.activeElement!);
  expect(document.activeElement).toBe(button("Command"));
  await key("ArrowRight", {}, document.activeElement!);
  await key("ArrowRight", {}, document.activeElement!);
  expect(document.activeElement).toBe(button("Files"));
  await key("Enter", {}, document.activeElement!);
  expect(entry.run).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  // happy-dom does not synthesize the native button click after a keydown.
  await click(button("Files")); expect(input().value).toBe("files: config");
  expect(document.activeElement).toBe(input());
  await key("s", { altKey: true, code: "KeyS" });
  expect(document.activeElement).toBe(button("Files"));
  await key("Escape", {}, document.activeElement!);
  expect(document.activeElement).toBe(input()); expect(close).not.toHaveBeenCalled();
  expect(sourcesButton().getAttribute("aria-expanded")).toBe("false");
  const footerButton = document.querySelector<HTMLButtonElement>(".launcher-footer button")!;
  await key("Enter", {}, footerButton);
  expect(entry.run).not.toHaveBeenCalled();
});

it("preserves provider relevance scores instead of re-ranking indexed results by their labels", async () => {
  await render([
    command("strong", { label: "src/parser.ts", kind: "code", group: "Code", alwaysShow: true, searchScore: 40 }),
    command("weak", { label: "pod name parsing.ts", kind: "code", group: "Code", alwaysShow: true, searchScore: 2 }),
  ]);
  await type("code: pod name parsing");
  expect(items().map((row) => row.getAttribute("data-value"))).toEqual(["strong", "weak"]);
});

it("caps and counts matching rows only, and Show more preserves the query", async () => {
  const commands = [
    ...Array.from({ length: 12 }, (_, index) => command("file" + index, { label: "config " + index, kind: "file", group: "Files" })),
    ...Array.from({ length: 25 }, (_, index) => command("unrelated" + index, { kind: "file", group: "Files" })),
  ];
  await render(commands); await type("config");
  expect(items()).toHaveLength(9);
  expect(item("Show 4 more results")).toBeDefined();
  await click(item("Show 4 more results"));
  expect(input().value).toBe("files: config");
  expect(items()).toHaveLength(12); expect(close).not.toHaveBeenCalled();
});

it("Show more infers grep from Files results instead of changing it to filename search", async () => {
  await render(Array.from({ length: 10 }, (_, index) => command("hit" + index, { kind: "grep", group: "Files", alwaysShow: true })));
  await type("actual content");
  await click(item("Show 2 more results"));
  expect(input().value).toBe("grep: actual content");
  expect(items()).toHaveLength(10);
});

it("expands mixed-kind groups in place and shows a real empty state", async () => {
  await render(Array.from({ length: 10 }, (_, index) => command("zebra " + index, { kind: index % 2 ? "note" : "file", group: "Mixed" })));
  await click(item("Show 2 more results")); expect(items()).toHaveLength(10);
  await type("xxxxxxxxxx"); expect(items()).toHaveLength(0);
  expect(document.querySelector("[cmdk-empty]")?.textContent).toBe("No results found.");
});

it("supports real Arrow, Tab, Shift+Tab and Enter navigation without reordering the groups", async () => {
  const first = command("first", { group: "Notes", kind: "note" });
  const second = command("second", { group: "Files", kind: "file" });
  await render([second, first]);
  expect(items()[0].getAttribute("aria-selected")).toBe("true");
  await key("ArrowDown"); expect(items()[1].getAttribute("aria-selected")).toBe("true");
  await key("Tab", { shiftKey: true }); expect(items()[0].getAttribute("aria-selected")).toBe("true");
  await key("Tab"); await key("Enter");
  expect(second.run).toHaveBeenCalledOnce(); expect(first.run).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
});

it("does not execute during IME composition", async () => {
  const run = vi.fn(); const secondary = vi.fn();
  await render([command("thing", { run, secondary: { label: "Copy", run: secondary } })]);
  await key("Enter", { isComposing: true });
  await key("Enter", { isComposing: true, metaKey: true });
  expect(run).not.toHaveBeenCalled(); expect(secondary).not.toHaveBeenCalled();
});

it("shows the selected full destination and contextual primary and secondary labels", async () => {
  await render([command("thing", { primaryLabel: "Stage command", detail: "/full/project/path/file.ts", secondary: { label: "Copy path", run: vi.fn() } })]);
  const footer = document.querySelector(".launcher-footer")!;
  expect(footer.textContent).toContain("/full/project/path/file.ts");
  expect(footer.textContent).toContain("↵ Stage command"); expect(footer.textContent).toContain("Copy path");
});

it("opening confirmation runs nothing and focuses Cancel, never the destructive button", async () => {
  const run = vi.fn();
  await render([command("danger", { run, confirmation: { title: "Review command", description: "Terminal A\nrestart exact-service", confirmLabel: "Stage command" } })]);
  await key("Enter");
  expect(run).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Terminal A\nrestart exact-service");
  expect(document.activeElement).toBe(button("Cancel"));
  await key("Enter", {}, document.activeElement!);
  expect(run).not.toHaveBeenCalled();
  await click(button("Cancel"));
  expect(input()).not.toBeNull(); expect(run).not.toHaveBeenCalled();
});

it("Escape cancels confirmation, then backs out of the action menu without running anything", async () => {
  const run = vi.fn();
  await render([command("danger", { run, confirmation: { title: "Confirm", description: "Exact target", confirmLabel: "Proceed" } })]);
  await key(".", { ctrlKey: true }); await key("Enter");
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await key("Escape", {}, document.activeElement!);
  expect(input().placeholder).toContain("Filter actions"); expect(run).not.toHaveBeenCalled();
  await key("Escape"); expect(input().placeholder).not.toContain("Filter actions"); expect(close).not.toHaveBeenCalled();
});

it("supports confirmation on secondary keyboard actions and additional action-menu verbs", async () => {
  const secondary = vi.fn(); const extra = vi.fn();
  await render([command("thing", {
    secondary: { label: "Delete", run: secondary, confirmation: { title: "Delete?", description: "one target", confirmLabel: "Delete now" } },
    actions: [{ label: "Stage command", hint: "Restart", run: extra, confirmation: { title: "Restart?", description: "exact restart text", confirmLabel: "Stage" } }],
  })]);
  await key("Enter", { ctrlKey: true }); expect(secondary).not.toHaveBeenCalled();
  await click(button("Cancel")); await key(".", { metaKey: true });
  await type("Restart"); await key("Enter"); expect(extra).not.toHaveBeenCalled();
  await click(button("Stage")); expect(extra).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
});

it("waits for asynchronous success, records only success, and exposes retryable errors", async () => {
  let reject!: (reason: Error) => void;
  const run = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; })).mockResolvedValue(undefined);
  await render([command("async", { run })]); await key("Enter");
  expect(close).not.toHaveBeenCalled(); expect(history.record).not.toHaveBeenCalled(); expect(input().disabled).toBe(true);
  await act(async () => reject(new Error("Target disconnected"))); await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Target disconnected"); expect(input().disabled).toBe(false);
  expect(close).not.toHaveBeenCalled(); expect(history.record).not.toHaveBeenCalled();
  await click(item("async")); expect(close).toHaveBeenCalledOnce(); expect(history.record).toHaveBeenCalledWith("async");
});

it("failed confirmed actions keep the confirmation and error available", async () => {
  await render([command("async", { run: vi.fn().mockRejectedValue(new Error("Permission denied")), confirmation: { title: "Confirm", description: "one target", confirmLabel: "Proceed" } })]);
  await key("Enter"); await click(button("Proceed"));
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Permission denied");
  expect(close).not.toHaveBeenCalled(); expect(history.record).not.toHaveBeenCalled();
});

it("keepOpen scope rows also stay open when invoked through their actions menu", async () => {
  const run = vi.fn();
  await render([command("scope", { label: "Search Files", keepOpen: true, run })]);
  await key(".", { ctrlKey: true }); await key("Enter");
  expect(run).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled(); expect(history.record).not.toHaveBeenCalled();
  expect(input().placeholder).not.toContain("Filter actions");
});
