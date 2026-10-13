// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  type Uri = { fsPath: string; path: string; scheme: string };
  type ViewState = { line: number; column: number; scrollTop: number };
  const models = new Map<string, Model>();
  class Model {
    private text: string;
    private version = 1;
    private alternativeVersion = 1;
    private history: { text: string; version: number }[] = [];
    private disposed = false;
    readonly listeners = new Set<() => void>();
    constructor(text: string, readonly uri: Uri) { this.text = text; }
    getValue() { return this.text; }
    getValueInRange() { return this.text; }
    getVersionId() { return this.version; }
    getAlternativeVersionId() { return this.alternativeVersion; }
    getLineCount() { return this.text.split("\n").length; }
    getFullModelRange() { return {}; }
    getPositionAt() { return { lineNumber: 1, column: 1 }; }
    updateOptions = vi.fn();
    isDisposed() { return this.disposed; }
    onDidChangeContent(listener: () => void) {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    }
    edit(text: string) {
      this.history.push({ text: this.text, version: this.alternativeVersion });
      this.text = text;
      this.alternativeVersion = ++this.version;
      for (const listener of this.listeners) listener();
    }
    pushEditOperations(_selections: unknown, edits: { text: string }[]) { this.edit(edits[0].text); }
    undo() {
      const previous = this.history.pop();
      if (!previous) return;
      this.text = previous.text;
      this.alternativeVersion = previous.version;
      this.version++;
      for (const listener of this.listeners) listener();
    }
    dispose() {
      this.disposed = true;
      this.listeners.clear();
      if (models.get(this.uri.fsPath) === this) models.delete(this.uri.fsPath);
    }
  }
  class Editor {
    model: Model | null = null;
    state: ViewState = { line: 1, column: 1, scrollTop: 0 };
    save: (() => void) | null = null;
    readonly focus = vi.fn();
    readonly layout = vi.fn();
    readonly updateOptions = vi.fn();
    readonly dispose = vi.fn();
    readonly addAction = vi.fn();
    readonly getContribution = vi.fn();
    readonly revealLineInCenter = vi.fn();
    getModel() { return this.model; }
    setModel(model: Model | null) { this.model = model; this.state = { line: 1, column: 1, scrollTop: 0 }; }
    saveViewState() { return { ...this.state }; }
    restoreViewState(state: ViewState) { this.state = { ...state }; }
    getSelection() { return { isEmpty: () => false, startLineNumber: 1, endLineNumber: 1 }; }
    setPosition(position: { lineNumber: number; column: number }) {
      this.state.line = position.lineNumber; this.state.column = position.column;
    }
    addCommand(_key: number, save: () => void) { this.save = save; }
  }
  const editors: Editor[] = [];
  const create = vi.fn(() => { const editor = new Editor(); editors.push(editor); return editor; });
  const createModel = vi.fn((text: string, _language: string, uri: Uri) => {
    const model = new Model(text, uri); models.set(uri.fsPath, model); return model;
  });
  return {
    models, editors, create, createModel,
    read: vi.fn<(path: string) => Promise<string>>(),
    write: vi.fn<(path: string, text: string) => Promise<void>>(),
    sshRead: vi.fn<(host: string, path: string) => Promise<string>>(),
    sshWrite: vi.fn<(host: string, path: string, text: string) => Promise<void>>(),
    toast: vi.fn(),
    prefs: { theme: "dark", vimMode: false, editorTabSize: 2 },
  };
});

vi.mock("./monacoEnv", () => ({
  defineHuskTheme: vi.fn(),
  monaco: {
    editor: {
      create: fixture.create, createModel: fixture.createModel,
      getModel: (uri: { fsPath: string }) => fixture.models.get(uri.fsPath) ?? null,
      getModels: () => [...fixture.models.values()], setTheme: vi.fn(),
    },
    Uri: { file: (path: string) => ({ fsPath: path, path, scheme: "file" }) },
    KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 }, Range: class {},
  },
}));
vi.mock("monaco-vim", () => ({ initVimMode: vi.fn() }));
vi.mock("../settings/preferences", () => ({ usePrefs: () => fixture.prefs, getPrefs: () => fixture.prefs }));
vi.mock("../styles/fonts", () => ({ fontStack: () => "monospace" }));
vi.mock("../fs", () => ({ readFile: fixture.read, writeFile: fixture.write }));
vi.mock("../remote/remoteFs", () => ({ sshReadFile: fixture.sshRead, sshWriteFile: fixture.sshWrite }));
vi.mock("../timeline/store", () => ({ recordTimelineEvent: vi.fn() }));
vi.mock("../toast", () => ({ toast: fixture.toast }));
vi.mock("./EditorContextMenu", () => ({ EditorContextMenu: () => null }));

import { EditorArea, onFileChanged, type EditorRevealTarget, type OpenFile } from "./EditorArea";
import { clearState, getFileState, markDeleted, markModified, markSaved, useFileState } from "./dirtyStore";
import { applyAiEdit, getEditorDocument, getEditorFile, getEditorSelection, replaceEditorDocument } from "../ai/editorStore";

const noteA = { path: "/vault/a.md", name: "a.md" };
const noteB = { path: "/vault/b.md", name: "b.md" };
let root: Root;
let container: HTMLDivElement;
let hostWidth: number;
let hostHeight: number;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
async function render(activePath: string | null = noteA.path, options: {
  visible?: boolean; files?: OpenFile[]; revealTarget?: EditorRevealTarget; placementKey?: string | number;
} = {}) {
  await act(async () => root.render(createElement(EditorArea, {
    activePath, files: options.files ?? [noteA, noteB], visible: options.visible ?? true,
    revealTarget: options.revealTarget,
    placementKey: options.placementKey,
  })));
}
const editor = () => fixture.editors[0];
const model = (path = noteA.path) => fixture.models.get(path)!;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  fixture.models.clear(); fixture.editors.length = 0;
  fixture.read.mockReset().mockImplementation(async (path) => `original ${path}\nsecond\nthird`);
  fixture.write.mockReset().mockResolvedValue(undefined);
  fixture.sshRead.mockReset().mockResolvedValue("remote text");
  fixture.sshWrite.mockReset().mockResolvedValue(undefined);
  hostWidth = 600; hostHeight = 240;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    x: 0, y: 0, top: 0, left: 0, right: hostWidth, bottom: hostHeight,
    width: hostWidth, height: hostHeight, toJSON: () => ({}),
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const path of fixture.models.keys()) clearState(path);
  clearState(noteA.path); clearState(noteB.path);
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it("preserves per-file cursor, scroll, draft, dirty state, and undo across repeated switches", async () => {
  await render();
  const original = model().getValue();
  model().edit("draft A");
  const originalModel = model();
  editor().state = { line: 8, column: 4, scrollTop: 640 };
  await render(noteB.path);
  model(noteB.path).edit("draft B");
  editor().state = { line: 3, column: 2, scrollTop: 220 };
  await render(noteA.path);
  expect(editor().getModel()).toBe(originalModel);
  expect(editor().state).toEqual({ line: 8, column: 4, scrollTop: 640 });
  expect(model().getValue()).toBe("draft A");
  expect(getFileState(noteA.path)).toBe("modified");
  expect(getFileState(noteB.path)).toBe("modified");
  expect(model().listeners.size).toBe(1);
  model().undo();
  expect(model().getValue()).toBe(original);
  expect(getFileState(noteA.path)).toBe("clean");
  await render(noteB.path);
  expect(editor().state).toEqual({ line: 3, column: 2, scrollTop: 220 });
  model(noteB.path).edit("another draft B");
  expect(getFileState(noteB.path)).toBe("modified");
  expect(fixture.create).toHaveBeenCalledTimes(1);
  expect(fixture.read).toHaveBeenCalledTimes(2);
});

it("keeps the same model, cursor, draft, and undo when a dock collapses and reopens", async () => {
  await render();
  const originalModel = model();
  const originalText = model().getValue();
  model().edit("dock draft"); editor().state = { line: 6, column: 3, scrollTop: 90 };
  await render(noteA.path, { visible: false });
  expect(model()).toBe(originalModel);
  expect(getFileState(noteA.path)).toBe("modified");
  await render(noteA.path, { visible: true });
  expect(editor().state).toEqual({ line: 6, column: 3, scrollTop: 90 });
  model().undo();
  expect(model().getValue()).toBe(originalText);
  expect(fixture.create).toHaveBeenCalledTimes(1);
});

it("does not focus or layout after a hidden late load, reveal, or resize", async () => {
  const read = deferred<string>(); fixture.read.mockReturnValueOnce(read.promise);
  await render();
  await render(noteA.path, { visible: false, revealTarget: { path: noteA.path, line: 2, requestId: 1 } });
  await act(async () => read.resolve("one\ntwo\nthree"));
  await act(async () => {
    window.dispatchEvent(new CustomEvent("husk:reveal-line", { detail: { path: noteA.path, line: 2 } }));
    window.dispatchEvent(new Event("resize"));
    vi.runAllTimers();
  });
  expect(editor().focus).not.toHaveBeenCalled();
  expect(editor().layout).not.toHaveBeenCalled();
  expect(editor().revealLineInCenter).not.toHaveBeenCalled();
  expect(getEditorFile()).toBeNull();
  expect(getEditorSelection()).toBeNull();
  expect(getEditorDocument()).toBeNull();
  expect(getEditorDocument(noteA.path)?.text).toBe("one\ntwo\nthree");
  expect(applyAiEdit("one", "not allowed while hidden")).toBe(false);
  await render();
  expect(editor().revealLineInCenter).toHaveBeenCalledWith(2);
  expect(editor().state.line).toBe(2);
});

it("cancels a queued layout retry when the dock collapses", async () => {
  hostHeight = 0;
  await render();
  await act(async () => vi.advanceTimersByTime(100));
  await render(noteA.path, { visible: false });
  await act(async () => vi.runAllTimers());
  expect(editor().focus).not.toHaveBeenCalled();
  expect(editor().layout).not.toHaveBeenCalled();
});

it("refocuses the same visible model after an explicit panel-to-tab placement change", async () => {
  await render(noteA.path, { placementKey: "panel" });
  await act(async () => vi.runAllTimers());
  const originalModel = model();
  model().edit("unsaved moved note");
  editor().state = { line: 3, column: 4, scrollTop: 85 };
  editor().focus.mockClear(); editor().layout.mockClear();

  await render(noteA.path, { placementKey: "tab" });
  await act(async () => vi.runAllTimers());
  expect(editor().focus).toHaveBeenCalledOnce();
  expect(editor().layout).toHaveBeenCalledWith({ width: 600, height: 240 });
  expect(editor().getModel()).toBe(originalModel);
  expect(model().getValue()).toBe("unsaved moved note");
  expect(editor().state).toEqual({ line: 3, column: 4, scrollTop: 85 });
  expect(fixture.create).toHaveBeenCalledTimes(1);

  editor().focus.mockClear();
  await render(noteA.path, { placementKey: "tab" });
  await act(async () => vi.runAllTimers());
  expect(editor().focus).not.toHaveBeenCalled();
});

it("does not focus a placement change while the editor is hidden", async () => {
  await render(noteA.path, { placementKey: "panel" });
  await render(noteA.path, { placementKey: "tab", visible: false });
  await act(async () => vi.runAllTimers());
  expect(editor().focus).not.toHaveBeenCalled();
  expect(editor().layout).not.toHaveBeenCalled();
});

it.each([
  { width: 600, height: 0 },
  { width: 600, height: 49 },
  { width: 0, height: 240 },
])("does not focus or reveal after retry when geometry remains $width × $height", async ({ width, height }) => {
  hostWidth = width; hostHeight = height;
  const revealTarget = { path: noteA.path, line: 2, requestId: 1 };
  await render(noteA.path, { placementKey: "panel", revealTarget });
  await act(async () => vi.runAllTimers());
  expect(editor().focus).not.toHaveBeenCalled();
  expect(editor().layout).not.toHaveBeenCalled();
  expect(editor().revealLineInCenter).not.toHaveBeenCalled();

  hostWidth = 600; hostHeight = 240;
  await render(noteA.path, { placementKey: "tab", revealTarget });
  await act(async () => vi.runAllTimers());
  expect(editor().focus).toHaveBeenCalled();
  expect(editor().revealLineInCenter).toHaveBeenCalledWith(2);
  expect(editor().state.line).toBe(2);
});

it("preserves edits made during async save and uses the persisted version as undo baseline", async () => {
  await render();
  model().edit("snapshot being saved");
  const save = deferred<void>(); fixture.write.mockReturnValueOnce(save.promise);
  editor().save!();
  expect(fixture.write).toHaveBeenCalledWith(noteA.path, "snapshot being saved");
  model().edit("newer unsaved draft");
  await act(async () => save.resolve());
  expect(getFileState(noteA.path)).toBe("modified");
  model().undo();
  expect(model().getValue()).toBe("snapshot being saved");
  expect(getFileState(noteA.path)).toBe("clean");
});

it("reports a rejected save and keeps the draft dirty", async () => {
  await render(); model().edit("unsaved");
  fixture.write.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => editor().save!());
  expect(getFileState(noteA.path)).toBe("modified");
  expect(fixture.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error", message: "Error: disk full" }));
});

it("finishes a switched-away model's save without changing the active draft", async () => {
  await render(); model().edit("saved A");
  const save = deferred<void>(); fixture.write.mockReturnValueOnce(save.promise); editor().save!();
  await render(noteB.path); model(noteB.path).edit("unsaved B");
  await act(async () => save.resolve());
  expect(getFileState(noteA.path)).toBe("clean");
  expect(getFileState(noteB.path)).toBe("modified");
  expect(editor().getModel()).toBe(model(noteB.path));
  expect(model(noteB.path).getValue()).toBe("unsaved B");
});

it("does not mark a replacement model clean when an earlier model's save finishes", async () => {
  await render(); model().edit("old draft");
  const save = deferred<void>(); fixture.write.mockReturnValueOnce(save.promise); editor().save!();
  await render(null, { files: [noteB] });
  await render(); model().edit("replacement draft");
  await act(async () => save.resolve());
  expect(model().getValue()).toBe("replacement draft");
  expect(getFileState(noteA.path)).toBe("modified");
});

it("tracks background models and preserves newer edits during explicit hidden Notes replacement", async () => {
  await render(); await render(noteB.path, { visible: false });
  const expected = model().getValue();
  const save = deferred<void>(); fixture.write.mockReturnValueOnce(save.promise);
  const replacing = replaceEditorDocument(noteA.path, expected, "organized");
  expect(model().getValue()).toBe("organized");
  expect(getFileState(noteA.path)).toBe("modified");
  model().edit("newer draft");
  await act(async () => save.resolve());
  expect(await replacing).toBe(true);
  expect(getFileState(noteA.path)).toBe("modified");
  model().undo(); expect(getFileState(noteA.path)).toBe("clean");
});

it("never reloads an unsaved draft or a remote model from local disk", async () => {
  await render(); model().edit("unsaved local"); fixture.read.mockClear();
  onFileChanged(noteA.path);
  expect(fixture.read).not.toHaveBeenCalled();
  await render(noteB.path, { files: [noteA, { ...noteB, remoteHost: "host" }] });
  expect(fixture.sshRead).toHaveBeenCalledWith("host", noteB.path);
  onFileChanged(noteB.path);
  expect(fixture.read).not.toHaveBeenCalled();
});

it("guards external reload against edits made while the disk read is pending", async () => {
  await render(); const read = deferred<string>(); fixture.read.mockReturnValueOnce(read.promise);
  onFileChanged(noteA.path); model().edit("typed while reading");
  await act(async () => read.resolve("external write"));
  expect(model().getValue()).toBe("typed while reading");
  expect(getFileState(noteA.path)).toBe("modified");
});

it("ignores external reloads for deleted, replaced, and stale-request models", async () => {
  await render(); const deletedRead = deferred<string>(); fixture.read.mockReturnValueOnce(deletedRead.promise);
  onFileChanged(noteA.path); markDeleted(noteA.path);
  await act(async () => deletedRead.resolve("deleted external"));
  expect(model().getValue()).not.toBe("deleted external");
  await render(null, { files: [noteB] }); await render();
  const replacedRead = deferred<string>(); fixture.read.mockReturnValueOnce(replacedRead.promise);
  onFileChanged(noteA.path);
  await render(null, { files: [noteB] }); await render();
  await act(async () => replacedRead.resolve("replaced external"));
  expect(model().getValue()).not.toBe("replaced external");
  const olderRead = deferred<string>(); const newerRead = deferred<string>();
  fixture.read.mockReturnValueOnce(olderRead.promise).mockReturnValueOnce(newerRead.promise);
  onFileChanged(noteA.path); onFileChanged(noteA.path);
  await act(async () => newerRead.resolve("newest disk text"));
  await act(async () => olderRead.resolve("older disk text"));
  expect(model().getValue()).toBe("newest disk text");
  expect(getFileState(noteA.path)).toBe("clean");
});

it("makes clean external updates undoable without losing the saved baseline", async () => {
  await render(); const original = model().getValue();
  fixture.read.mockResolvedValueOnce("external text");
  await act(async () => onFileChanged(noteA.path));
  expect(model().getValue()).toBe("external text");
  expect(getFileState(noteA.path)).toBe("clean");
  model().undo();
  expect(model().getValue()).toBe(original);
  expect(getFileState(noteA.path)).toBe("modified");
});

it("keeps the dock save status reactive without needing a parent render", async () => {
  function Status() { return createElement("span", null, useFileState(noteA.path)); }
  await act(async () => root.render(createElement(Status)));
  expect(container.textContent).toBe("clean");
  await act(async () => { markSaved(noteA.path, 1); markModified(noteA.path, 2); });
  expect(container.textContent).toBe("modified");
  await act(async () => markSaved(noteA.path, 2));
  expect(container.textContent).toBe("clean");
});
