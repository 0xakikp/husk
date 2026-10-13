// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  initialNotesDockState, notesDockReducer, NOTES_OPENING_MODE_KEY, useNotesDock,
  type NotesDockApi, type NotesDockState,
} from "./useNotesDock";

const noteA = { path: "/vault/project/a.md", name: "a.md", pinned: true };
const noteB = { path: "/vault/project/b.md", name: "b.md" };
const other = { path: "/vault/project-other/c.md", name: "c.md" };
let root: Root;
let container: HTMLDivElement;
let api: NotesDockApi;

function Probe() { api = useNotesDock(); return null; }
async function render() { await act(async () => root.render(createElement(Probe))); }
function openedNotes(): NotesDockState {
  return [noteA, noteB, other].reduce((state, file) => notesDockReducer(state, { type: "open", file, panel: true }), initialNotesDockState);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.restoreAllMocks();
});

it("retains previously opened file metadata without duplicating entries or mutating initial state", () => {
  const first = notesDockReducer(initialNotesDockState, { type: "open", file: noteA, panel: true });
  const second = notesDockReducer(first, { type: "open", file: noteB, panel: true });
  const revisited = notesDockReducer(second, { type: "open", file: { path: noteA.path, name: noteA.name }, panel: false });
  expect(initialNotesDockState).toEqual({ files: [], activePath: null, panelRequestId: 0, revealTarget: null });
  expect(first.files).toEqual([{ ...noteA, remoteHost: null }]);
  expect(revisited.files).toBe(second.files);
  expect(revisited.files).toHaveLength(2);
  expect(revisited.files[0]).toBe(first.files[0]);
  expect(revisited.files[0].pinned).toBe(true);
  expect(revisited.activePath).toBe(noteA.path);
  expect(revisited.panelRequestId).toBe(2);
});

it("uses local note files even if a stale remote association is supplied", () => {
  const state = notesDockReducer(initialNotesDockState, { type: "open", file: { ...noteA, remoteHost: "production" }, panel: true });
  expect(state.files[0].remoteHost).toBeNull();
});

it("issues fresh panel and reveal requests for repeated opens, but not for tab opens", () => {
  const first = notesDockReducer(initialNotesDockState, { type: "open", file: noteA, panel: true, line: 7 });
  const second = notesDockReducer(first, { type: "open", file: noteA, panel: true, line: 7 });
  const third = notesDockReducer(second, { type: "open", file: noteB, panel: false, line: 3 });
  expect(second.panelRequestId).toBe(first.panelRequestId + 1);
  expect(second.revealTarget).toEqual({ path: noteA.path, line: 7, requestId: 2 });
  expect(third.panelRequestId).toBe(second.panelRequestId);
  expect(third.revealTarget).toEqual({ path: noteB.path, line: 3, requestId: 3 });
});

it.each([undefined, 0, -1, 1.5, NaN, Infinity])("does not create a reveal request for invalid line %s", (line) => {
  const state = notesDockReducer(initialNotesDockState, { type: "open", file: noteA, panel: true, line });
  expect(state.revealTarget).toBeNull();
});

it("moves a selected note and pending reveal while keeping pinned metadata", () => {
  const opened = notesDockReducer(openedNotes(), { type: "open", file: noteA, panel: true, line: 4 });
  const moved = notesDockReducer(opened, { type: "move", from: noteA.path, to: "/vault/renamed.md" });
  expect(moved.files[0]).toEqual({ path: "/vault/renamed.md", name: "renamed.md", pinned: true, remoteHost: null });
  expect(moved.activePath).toBe("/vault/renamed.md");
  expect(moved.revealTarget).toEqual({ ...opened.revealTarget, path: "/vault/renamed.md" });
  expect(moved.files[1]).toBe(opened.files[1]);
  expect(moved.panelRequestId).toBe(opened.panelRequestId);
  expect(opened.files[0].path).toBe(noteA.path);
});

it("remaps only descendants of a moved folder, not similarly prefixed siblings", () => {
  const opened = notesDockReducer(openedNotes(), { type: "open", file: noteB, panel: true, line: 4 });
  const moved = notesDockReducer(opened, { type: "move", from: "/vault/project/", to: "/vault/archive/" });
  expect(moved.files.map((file) => file.path)).toEqual(["/vault/archive/a.md", "/vault/archive/b.md", other.path]);
  expect(moved.files[2]).toBe(opened.files[2]);
  expect(moved.activePath).toBe("/vault/archive/b.md");
  expect(moved.revealTarget?.path).toBe("/vault/archive/b.md");
});

it("removes deleted descendants, chooses a surviving active note, and clears deleted reveals", () => {
  const opened = notesDockReducer(openedNotes(), { type: "open", file: noteA, panel: true, line: 4 });
  const deleted = notesDockReducer(opened, { type: "delete", path: "/vault/project" });
  expect(deleted.files.map((file) => file.path)).toEqual([other.path]);
  expect(deleted.activePath).toBe(other.path);
  expect(deleted.revealTarget).toBeNull();
  expect(deleted.panelRequestId).toBe(opened.panelRequestId);
  const empty = notesDockReducer(deleted, { type: "delete", path: other.path });
  expect(empty.files).toEqual([]); expect(empty.activePath).toBeNull();
});

it("does not change the selected note or pending reveal when a different note is deleted", () => {
  const opened = notesDockReducer(openedNotes(), { type: "open", file: noteA, panel: true, line: 9 });
  const deleted = notesDockReducer(opened, { type: "delete", path: noteB.path });
  expect(deleted.activePath).toBe(noteA.path);
  expect(deleted.revealTarget).toBe(opened.revealTarget);
  expect(deleted.files.map((file) => file.path)).toEqual([noteA.path, other.path]);
});

it("defaults to the panel without persisting note paths, contents, or editor metadata", async () => {
  const writes = vi.spyOn(localStorage, "setItem");
  await render(); expect(api.preferredMode).toBe("panel");
  let mode: string | undefined;
  await act(async () => { mode = api.open(noteA.path, noteA.name, 5); });
  expect(mode).toBe("panel"); expect(api.panelRequestId).toBe(1);
  expect(api.activePath).toBe(noteA.path);
  expect(api.revealTarget).toEqual({ path: noteA.path, line: 5, requestId: 1 });
  await act(async () => api.movePath(noteA.path, "/vault/moved.md"));
  expect(api.activePath).toBe("/vault/moved.md");
  await act(async () => api.deletePath("/vault/moved.md"));
  expect(api.activePath).toBeNull(); expect(api.files).toEqual([]);
  expect(writes).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0);
});

it("persists only the opening preference and permits one-off overrides without changing it", async () => {
  localStorage.setItem(NOTES_OPENING_MODE_KEY, "tab");
  const writes = vi.spyOn(localStorage, "setItem");
  await render(); expect(api.preferredMode).toBe("tab");
  let mode: string | undefined;
  await act(async () => { mode = api.open(noteA.path, noteA.name); });
  expect(mode).toBe("tab"); expect(api.panelRequestId).toBe(0);
  await act(async () => { mode = api.open(noteA.path, noteA.name, undefined, "panel"); });
  expect(mode).toBe("panel"); expect(api.panelRequestId).toBe(1);
  expect(api.preferredMode).toBe("tab"); expect(writes).not.toHaveBeenCalled();
  await act(async () => api.setPreferredMode("panel"));
  expect(writes).toHaveBeenCalledExactlyOnceWith(NOTES_OPENING_MODE_KEY, "panel");
  await act(async () => { mode = api.open(noteB.path, noteB.name); });
  expect(mode).toBe("panel"); expect(api.panelRequestId).toBe(2);
  expect(localStorage.length).toBe(1);
  expect([...api.files].map((file) => Object.keys(file).sort())).toEqual([["name", "path", "remoteHost"], ["name", "path", "remoteHost"]]);
});

it("falls back from unknown stored modes and retains a session preference if storage is unavailable", async () => {
  localStorage.setItem(NOTES_OPENING_MODE_KEY, "unknown");
  await render(); expect(api.preferredMode).toBe("panel");
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
  await act(async () => api.setPreferredMode("tab"));
  expect(api.preferredMode).toBe("tab");
  await act(async () => { expect(api.open(noteA.path, noteA.name)).toBe("tab"); });
  expect(api.panelRequestId).toBe(0); expect(api.activePath).toBe(noteA.path);
});

it("still initializes safely when local storage cannot be read", async () => {
  vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("storage blocked"); });
  await render(); expect(api.preferredMode).toBe("panel"); expect(api.files).toEqual([]);
});
