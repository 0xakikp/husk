// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  root: "/project", query: vi.fn(), clear: vi.fn(), copy: vi.fn(), toast: vi.fn(), stage: vi.fn(),
  enabled: true, setRecording: vi.fn(), subscribers: new Set<() => void>(),
}));
vi.mock("../workspace/store", () => ({ useWorkspaceRoot: () => mock.root }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: mock.copy }));
vi.mock("../toast", () => ({ toast: mock.toast }));
vi.mock("../workflows/draftStore", () => ({ stageWorkflowDraft: mock.stage }));
vi.mock("./store", () => ({
  queryTimeline: mock.query, clearWorkspaceTimeline: mock.clear,
  listTimelineWorkspaces: async () => [],
  isTimelineRecordingEnabled: () => mock.enabled,
  setTimelineRecordingEnabled: mock.setRecording,
  subscribeTimeline: (fn: () => void) => { mock.subscribers.add(fn); return () => mock.subscribers.delete(fn); },
}));
vi.mock("../workflows/suggestions", async () => {
  const { readTimelineCommand } = await import("./commandMetadata");
  return {
    clearWorkflowSuggestionsForWorkspace: vi.fn(),
    isSafeWorkflowSuggestionCommand: (command: string) => command.startsWith("pnpm "),
    timelineCommand: (event: import("./store").TimelineEvent) => {
      const value = readTimelineCommand(event);
      return value ? { id: event.id, ts: event.ts, command: value.command, failed: event.event_type === "command_failed" } : null;
    },
  };
});
// Portal primitives aren't under test; preserve real row/header interactions.
vi.mock("@/components/ui/popover", () => ({ Popover: ({ children }: { children: ReactNode }) => <>{children}</>, PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>, PopoverContent: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>, Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>, TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>, TooltipContent: () => null }));
import { TimelineView } from "./TimelineView";
import type { TimelineEvent } from "./store";

let root: Root; let host: HTMLDivElement;
const event = (id = 1, command = "pnpm test", patch: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id, ts: 1_700_000_000 + id, event_type: "command", summary: `Ran ${command}`, workspace_id: "/project", sensitivity: 0,
  metadata_json: JSON.stringify({ command, commandFormat: "exact-v1", exitCode: 0, durationMs: 1500, cwd: "/project" }), ...patch,
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); mock.root = "/project"; mock.enabled = true; mock.subscribers.clear();
  mock.query.mockReset().mockResolvedValue([event()]); mock.clear.mockReset().mockResolvedValue(undefined); mock.copy.mockReset().mockResolvedValue(undefined);
  mock.setRecording.mockImplementation((value: boolean) => { mock.enabled = value; for (const fn of mock.subscribers) fn(); return true; });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() { await act(async () => root.render(<TimelineView />)); }
function button(label: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label)!; }
async function click(label: string) { const node = button(label); expect(node).toBeDefined(); await act(async () => node.click()); }
async function expand(index = 0) { const rows = host.querySelectorAll<HTMLButtonElement>("button[aria-expanded][aria-controls]"); await act(async () => rows[index].click()); }
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

it("opens full command details and copies only on explicit action, with no workflow side effect", async () => {
  const command = 'printf "%s" "a   b"'; mock.query.mockResolvedValue([event(1, command)]);
  await render(); expect(mock.query).toHaveBeenCalledWith([], 90, 200, "/project");
  await expand();
  expect(host.querySelector("pre")?.textContent).toBe(command);
  expect(host.textContent).toContain("Exit 0 · completed"); expect(host.textContent).toContain("1.5 s");
  expect(mock.copy).not.toHaveBeenCalled(); expect(mock.stage).not.toHaveBeenCalled();
  await click("Copy command"); expect(mock.copy).toHaveBeenCalledWith(command); expect(button("Copied")).toBeDefined();
});
it("keeps only one detail section open and preserves keyboard button semantics", async () => {
  mock.query.mockResolvedValue([event(2, "pnpm build"), event()]); await render(); await expand(); await expand(1);
  expect(host.querySelectorAll("pre")).toHaveLength(1); expect(host.querySelector("pre")?.textContent).toBe("pnpm test");
  expect(host.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(1);
  await expand(1); expect(host.querySelectorAll("pre")).toHaveLength(0);
});
it("provides honest feedback and retry when clipboard access fails", async () => {
  mock.copy.mockRejectedValueOnce(new Error("private backend detail")); await render(); await expand(); await click("Copy command");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not copy"); expect(host.textContent).not.toContain("private backend");
  await click("Copy command"); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(button("Copied")).toBeDefined();
});
it("does not offer command copying or selection for summary-only and redacted entries", async () => {
  mock.query.mockResolvedValue([event(2, "private", { sensitivity: 1 }), event(1, "pwd", { metadata_json: "" })]);
  await render(); expect(host.textContent).not.toContain("private");
  await expand(); expect(button("Copy command")).toBeUndefined();
  await expand(1); expect(host.textContent).toContain("Only a summary is available"); expect(button("Copy command")).toBeUndefined();
  await click("Create workflow from Timeline commands");
  expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => input.disabled)).toBe(true);
});
it("requires confirmation for deletion and supports cancel", async () => {
  await render(); await click("clear"); expect(mock.clear).not.toHaveBeenCalled();
  expect(host.textContent).toContain("This cannot be undone"); await click("Cancel"); expect(mock.clear).not.toHaveBeenCalled();
  await click("clear"); mock.query.mockResolvedValue([]); await click("Delete timeline");
  expect(mock.clear).toHaveBeenCalledWith("/project"); expect(mock.clear).toHaveBeenCalledTimes(1); expect(host.querySelector("pre")).toBeNull();
  expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Timeline cleared" }));
});
it("guards duplicate deletion and keeps a failed confirmation available to retry", async () => {
  const pending = deferred<void>(); mock.clear.mockReturnValueOnce(pending.promise);
  await render(); await click("clear"); const confirm = button("Delete timeline");
  await act(async () => { confirm.click(); confirm.click(); }); expect(mock.clear).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("private error")));
  expect(button("Delete timeline")).toBeDefined(); expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not clear timeline" }));
});
it("ignores stale workspace responses", async () => {
  const old = deferred<TimelineEvent[]>(); mock.query.mockReturnValueOnce(old.promise);
  await render(); mock.root = "/other"; mock.query.mockResolvedValue([event(2, "other command")]); await render();
  expect(host.textContent).toContain("other command");
  await act(async () => old.resolve([event(1, "old command")]));
  expect(host.textContent).not.toContain("old command"); expect(host.textContent).toContain("other command");
});
it("shows load errors with retry instead of a misleading empty or previous timeline", async () => {
  mock.query.mockRejectedValueOnce(new Error("private path")); await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load");
  expect(host.textContent).not.toContain("private path"); await click("Retry"); expect(host.textContent).toContain("Ran pnpm test");
});
it("resets workflow selection on filters and builds selected commands in chronological order", async () => {
  mock.query.mockResolvedValue([event(2, "pnpm build"), event(1, "pnpm test")]); await render(); await click("Create workflow from Timeline commands");
  const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  await act(async () => { boxes[0].click(); boxes[1].click(); });
  await click("review workflow"); expect(mock.stage).toHaveBeenCalledWith(expect.objectContaining({ steps: ["pnpm test", "pnpm build"] }));
  const files = host.querySelector<HTMLButtonElement>('button[title="Files"]')!;
  await act(async () => files.click()); expect(host.textContent).toContain("0/100 selected"); expect(button("review workflow").disabled).toBe(true);
});
it("searches loaded details without exposing hidden metadata", async () => {
  mock.query.mockResolvedValue([event(2, "pnpm build"), event(1, "pnpm test")]); await render();
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "build");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.textContent).toContain("Ran pnpm build"); expect(host.textContent).not.toContain("Ran pnpm test"); expect(host.textContent).toContain("1 matches · 2 loaded");
});
it("loads more within an explicit bounded history window", async () => {
  mock.query.mockResolvedValue(Array.from({ length: 200 }, (_, id) => event(id + 1))); await render();
  await click("Load 200 more"); expect(mock.query).toHaveBeenLastCalledWith([], 90, 400, "/project");
});
it("updates recording state from the store and disables recording for the displayed workspace", async () => {
  await render(); await click("Stop recording this workspace");
  expect(mock.setRecording).toHaveBeenCalledWith(false, "/project"); expect(button("Resume recording this workspace")).toBeDefined();
});
it("warns when a recording preference only applies until restart", async () => {
  mock.setRecording.mockReturnValueOnce(false); await render(); await click("Stop recording this workspace");
  expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning", message: expect.stringContaining("this session only") }));
});
