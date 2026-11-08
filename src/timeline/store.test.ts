// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../workspace/store", () => ({ getWorkspaceRoot: () => "/project" }));
import { clearWorkspaceTimeline, isTimelineRecordingEnabled, queryTimeline, recordTimelineEvent, setTimelineRecordingEnabled, subscribeTimeline } from "./store";

const key = "husk.timeline.disabledWorkspaces";
beforeEach(() => {
  vi.restoreAllMocks(); invoke.mockReset().mockResolvedValue([]); localStorage.clear();
  setTimelineRecordingEnabled(true, "/project"); setTimelineRecordingEnabled(true, "/other");
});
it("persists opt-outs for the explicit workspace without touching another", async () => {
  setTimelineRecordingEnabled(false, "/other");
  expect(isTimelineRecordingEnabled("/project")).toBe(true);
  expect(isTimelineRecordingEnabled("/other")).toBe(false);
  expect(await recordTimelineEvent("command", "Ran pwd", {}, { workspaceRoot: "/other" })).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
});
it("retains a failed-write opt-out for the session and retries persistence later", async () => {
  const setter = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(setTimelineRecordingEnabled(false)).toBe(false);
  expect(isTimelineRecordingEnabled()).toBe(false);
  expect(await recordTimelineEvent("command", "Ran pwd")).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  setter.mockRestore(); setTimelineRecordingEnabled(false, "/other");
  expect(JSON.parse(localStorage.getItem(key)!)).toEqual(expect.arrayContaining(["/project", "/other"]));
});
it("does not turn malformed preference data into a set of characters or forget a known opt-out", () => {
  setTimelineRecordingEnabled(false);
  for (const raw of ['"/project"', "null", "{}", '["/project",4]', "broken"]) {
    localStorage.setItem(key, raw);
    expect(isTimelineRecordingEnabled()).toBe(false);
  }
});
it("notifies subscribers of other-window recording changes", () => {
  const fn = vi.fn(); const unsubscribe = subscribeTimeline(fn);
  localStorage.setItem(key, JSON.stringify(["/project"]));
  window.dispatchEvent(new StorageEvent("storage", { key }));
  expect(fn).toHaveBeenCalledTimes(1); expect(isTimelineRecordingEnabled()).toBe(false);
  window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
  expect(fn).toHaveBeenCalledTimes(1); unsubscribe();
});
it("never lets malformed metadata or an unavailable native backend break its caller", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const metadata: Record<string, unknown> = {}; metadata.circular = metadata;
  expect(await recordTimelineEvent("command", "Ran pwd", metadata)).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  invoke.mockImplementationOnce(() => { throw new Error("unavailable"); });
  expect(await recordTimelineEvent("command", "Ran pwd")).toBe(false);
  invoke.mockRejectedValueOnce(new Error("private native details"));
  expect(await recordTimelineEvent("command", "Ran pwd")).toBe(false);
  expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("private"));
});
it("records once and emits only after successful storage", async () => {
  const fn = vi.fn(); const unsubscribe = subscribeTimeline(fn);
  expect(await recordTimelineEvent("command", " Ran pwd ", { command: "pwd" })).toBe(true);
  expect(invoke).toHaveBeenCalledWith("timeline_record", expect.objectContaining({ workspaceId: "/project", summary: "Ran pwd", metadataJson: '{"command":"pwd"}' }));
  expect(fn).toHaveBeenCalledTimes(1); unsubscribe();
});
it("queries and clears only the requested workspace", async () => {
  await queryTimeline(["file"], 90, 400, "/other");
  expect(invoke).toHaveBeenCalledWith("timeline_query", { workspaceId: "/other", eventTypes: ["file"], sinceDays: 90, limit: 400 });
  await clearWorkspaceTimeline("/other");
  expect(invoke).toHaveBeenCalledWith("timeline_clear", { workspaceId: "/other" });
  invoke.mockClear(); await clearWorkspaceTimeline(""); await queryTimeline([], 30, 200, "");
  expect(invoke).not.toHaveBeenCalled();
});
