// @vitest-environment happy-dom
import { act, useEffect, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OpenFile } from "../editor/EditorArea";
import type { ActiveKind } from "./types";
import { useNotesDock, type NotesDockApi, type NotesOpeningMode } from "../notes/useNotesDock";
import { clearState, markModified, markSaved } from "../editor/dirtyStore";

const life = vi.hoisted(() => ({ editorMount: vi.fn(), editorUnmount: vi.fn(), terminalMount: vi.fn(), terminalUnmount: vi.fn(), toast: vi.fn() }));
vi.mock("../TerminalStack", () => ({ TerminalStack: ({ onOpenLogs }: { onOpenLogs: (id: number) => void }) => {
  useEffect(() => { life.terminalMount(); return () => { life.terminalUnmount(); }; }, []);
  return <div data-terminal><button onClick={() => onOpenLogs(1)}>Open logs</button></div>;
} }));
vi.mock("../editor/EditorArea", () => ({ EditorArea: ({ activePath, visible, files }: { activePath: string | null; visible: boolean; files: OpenFile[] }) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => { life.editorMount(); return () => { life.editorUnmount(); }; }, []);
  return <div data-editor data-visible={visible} data-files={files.map((file) => file.path).join(",")}>
    <output>{activePath ? drafts[activePath] ?? activePath : ""}</output>
    <button onClick={() => activePath && setDrafts((old) => ({ ...old, [activePath]: `edited ${activePath}` }))}>Edit draft</button>
  </div>;
} }));
vi.mock("../terminal/TerminalAiComposer", () => ({ TerminalAiComposer: () => <aside data-ai>AI composer</aside> }));
vi.mock("../terminal/TerminalLogs", () => ({ TerminalLogs: ({ onClose }: { onClose: () => void }) => <section data-logs><button onClick={onClose}>Close logs</button></section> }));
vi.mock("../kubernetes/K8sResourceDetailPanel", () => ({ default: () => <section data-kubernetes>Pod details</section> }));
vi.mock("../docker/DockerDetailPanel", () => ({ DockerDetailPanel: () => <section data-docker>Container details</section> }));
vi.mock("../terminal/TerminalBottomBar", () => ({ TerminalBottomBar: () => null }));
vi.mock("../terminal/FailureStrip", () => ({ FailureStrip: () => null }));
vi.mock("../terminal/NextStepStrip", () => ({ NextStepStrip: () => null }));
vi.mock("../terminal/runComparisonStrip", () => ({ RunComparisonStrip: () => null }));
vi.mock("../terminal/RememberFixStrip", () => ({ RememberFixStrip: () => null }));
vi.mock("../terminal/PortDetectedStrip", () => ({ PortDetectedStrip: () => null }));
vi.mock("../terminal/GitActivityStrip", () => ({ GitActivityStrip: () => null }));
vi.mock("../terminal/SensitiveOutputStrip", () => ({ SensitiveOutputStrip: () => null }));
vi.mock("../terminal/EnvironmentWarningStrip", () => ({ EnvironmentWarningStrip: () => null }));
vi.mock("../workflows/WorkflowSuggestionStrip", () => ({ WorkflowSuggestionStrip: () => null }));
vi.mock("../ai/sessionStore", () => ({ tabSessionId: (id: number) => String(id) }));
vi.mock("../ai/terminalContext", () => ({ focusActiveTerminal: vi.fn(), getActiveTerminalPtyId: vi.fn(), runInActiveTerminal: vi.fn() }));
vi.mock("../terminal/registry", () => ({ getSessionHandle: vi.fn() }));
vi.mock("../toast", () => ({ toast: life.toast }));

import { WorkspacePanels } from "./WorkspacePanels";
type Props = ComponentProps<typeof WorkspacePanels>;
let root: Root;
let host: HTMLDivElement;
let height: number;
const observers = new Set<ResizeObserverCallback>();
let api: { open: (path: string, name: string, line?: number, mode?: NotesOpeningMode) => void; notes: NotesDockApi; fullFiles: OpenFile[]; selectDetails: () => void; returnToTerm: () => void };

function Harness({ split = false }: { split?: boolean }) {
  const notes = useNotesDock();
  const [kind, setKind] = useState<ActiveKind>("term");
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [selection, setSelection] = useState<Props["selectedK8sResource"]>(null);
  const open = (path: string, name: string, line?: number, mode?: NotesOpeningMode) => {
    const target = notes.open(path, name, line, mode);
    if (target === "tab") {
      setFiles((old) => old.some((file) => file.path === path) ? old : [...old, { path, name, remoteHost: null }]);
      setActiveFile(path); setKind("file");
    } else setKind("term");
  };
  api = { open, notes, fullFiles: files, selectDetails: () => setSelection({ kind: "pod", name: "api" } as Props["selectedK8sResource"]), returnToTerm: () => setKind("term") };
  return <WorkspacePanels term={{ tabs: [{ id: 1, focused: 1, root: split
    ? { kind: "split", id: 3, dir: "row", ratio: 0.5, a: { kind: "leaf", id: 1 }, b: { kind: "leaf", id: 2 } }
    : { kind: "leaf", id: 1 } }], activeId: 1 } as Props["term"]}
    activeKind={kind} selectedK8sResource={selection} setSelectedK8sResource={setSelection} selectedDockerResource={null} setSelectedDockerResource={() => {}}
    prefs={{ aiPanelDock: "left", panelGaps: 8 } as Props["prefs"]} bgDataUrl={null} openFiles={files} activeFile={activeFile} notesDock={notes} onOpenNote={open}
    settingsOpen={false} openPanel={null} closeSettings={() => {}} closeGitGraph={() => {}} closeIssues={() => {}} closeSftp={() => {}} closeBrowser={() => {}}
    onOpenBrowser={() => {}} onOpenSourceControl={() => {}} onOpenAi={() => {}} onReturnFromAi={() => {}} onCloseAi={() => {}} chromeOccluded={false} />;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  height = 800;
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: 1000, height, top: 0, left: 0, right: 1000, bottom: height, x: 0, y: 0, toJSON() {} }));
  vi.stubGlobal("ResizeObserver", class { constructor(private cb: ResizeObserverCallback) { observers.add(cb); } observe() {} disconnect() { observers.delete(this.cb); } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); observers.clear();
  clearState("/notes/A.md"); clearState("/notes/B.md"); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const editor = () => host.querySelector<HTMLElement>("[data-editor]")!;
const dock = () => host.querySelector<HTMLElement>(".workspace-dock")!;
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
async function clickText(text: string) {
  const target = [...host.querySelectorAll("button")].find((item) => item.textContent === text)!;
  expect(target).toBeTruthy(); await act(async () => target.click());
}
async function start() { await act(async () => root.render(<Harness />)); }
async function open(path = "/notes/A.md", name = "A.md") { await act(async () => api.open(path, name)); }

it("lets split leaves own their borders without replacing the terminal stack", async () => {
  await start();
  const terminal = host.querySelector("[data-terminal]")!;
  const frame = terminal.parentElement!;
  expect(frame.classList.contains("border")).toBe(true);
  expect(frame.classList.contains("rounded-lg")).toBe(true);
  await act(async () => root.render(<Harness split />));
  expect(host.querySelector("[data-terminal]")).toBe(terminal);
  expect(frame.classList.contains("border")).toBe(false);
  expect(frame.classList.contains("rounded-lg")).toBe(false);
  await act(async () => root.render(<Harness />));
  expect(frame.classList.contains("border")).toBe(true);
  expect(life.terminalMount).toHaveBeenCalledOnce();
  expect(life.terminalUnmount).not.toHaveBeenCalled();
});

it("keeps one editor and all note drafts when switching notes, full tabs, and collapse", async () => {
  await start(); await open();
  const originalEditor = editor();
  await clickText("Edit draft");
  await open("/notes/B.md", "B.md");
  expect(editor()).toBe(originalEditor); expect(editor().dataset.files).toBe("/notes/A.md,/notes/B.md");
  await clickText("Edit draft");
  await clickText("A.md");
  expect(editor().textContent).toContain("edited /notes/A.md");
  await act(async () => button("Collapse workspace dock").click());
  expect(editor().dataset.visible).toBe("false");
  await act(async () => button("Expand workspace dock").click());
  expect(editor().dataset.visible).toBe("true");
  await act(async () => button("Open note in full tab").click());
  expect(editor()).toBe(originalEditor); expect(api.fullFiles.map((file) => file.path)).toEqual(["/notes/A.md"]);
  expect(editor().textContent).toContain("edited /notes/A.md");
  await act(async () => button("Move note below terminal").click());
  await clickText("B.md");
  expect(editor().textContent).toContain("edited /notes/B.md");
  await act(async () => button("Open note in full tab").click());
  expect(api.fullFiles).toHaveLength(2);
  expect(life.editorMount).toHaveBeenCalledOnce(); expect(life.editorUnmount).not.toHaveBeenCalled();
  expect(life.terminalMount).toHaveBeenCalledOnce(); expect(life.terminalUnmount).not.toHaveBeenCalled();
});

it("shares one dock for Notes, Logs and details outside the AI column", async () => {
  await start();
  const terminal = host.querySelector("[data-terminal]")!;
  const terminalColumn = terminal.parentElement!.parentElement!;
  const ai = terminalColumn.parentElement!.querySelector("[data-ai]")!;
  await open();
  expect(terminalColumn.contains(dock())).toBe(true);
  expect(ai.parentElement).toBe(terminalColumn.parentElement);
  expect(ai.contains(dock())).toBe(false);
  const originalDock = dock();
  await clickText("Open logs");
  expect(host.querySelectorAll(".workspace-dock")).toHaveLength(1);
  expect(editor().dataset.visible).toBe("false");
  expect(host.querySelector("[data-logs]")!.closest<HTMLElement>(".workspace-dock-page")!.hidden).toBe(false);
  await act(async () => api.selectDetails());
  expect(host.querySelector("[data-kubernetes]")).not.toBeNull();
  await clickText("Notes");
  expect(dock()).toBe(originalDock); expect(editor().dataset.visible).toBe("true");
  await clickText("Logs");
  expect(host.querySelector("[data-kubernetes]")).not.toBeNull();
  await act(async () => api.open("/notes/A.md", "A.md", undefined, "tab"));
  expect(dock()).toBe(originalDock); // Resource tools remain available beside a full file editor.
  expect(host.querySelectorAll("[data-editor]")).toHaveLength(1);
});

it("offers a full tab in cramped space without replacing or remounting the terminal", async () => {
  height = 220; await start(); await open();
  expect(dock().dataset.cramped).toBe("true"); expect(dock().dataset.expanded).toBe("false");
  expect(editor().dataset.visible).toBe("false"); expect(api.fullFiles).toHaveLength(0);
  expect(button("Open note in full tab")).not.toBeNull();
  await act(async () => button("Open note in full tab").click());
  expect(editor().dataset.visible).toBe("true"); expect(api.fullFiles).toHaveLength(1);
  expect(life.terminalUnmount).not.toHaveBeenCalled();
});

it("does not close an unsaved panel note and closes only metadata after saving", async () => {
  await start(); await open(); await open("/notes/B.md", "B.md");
  await act(async () => { markSaved("/notes/A.md", 1); markModified("/notes/A.md", 2); });
  await act(async () => button("Close A.md in Notes panel").click());
  expect(api.notes.files).toHaveLength(2); expect(life.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "This note has unsaved changes" }));
  await act(async () => markSaved("/notes/A.md", 2));
  await act(async () => button("Close A.md in Notes panel").click());
  expect(api.notes.files.map((file) => file.path)).toEqual(["/notes/B.md"]);
});

it("delivers the empty file list to the existing editor after the last panel note closes", async () => {
  await start(); await open();
  const original = editor();
  await act(async () => api.notes.deletePath("/notes/A.md"));
  expect(editor()).toBe(original); expect(editor().dataset.files).toBe("");
  expect(editor().dataset.visible).toBe("false"); expect(dock()).toBeNull();
  expect(life.editorUnmount).not.toHaveBeenCalled();
  await open(); expect(editor()).toBe(original); expect(life.editorMount).toHaveBeenCalledOnce();
});

it("does not open a panel in the background when full tab is the preferred opening mode", async () => {
  localStorage.setItem("husk.notes.openingMode", "tab");
  await start(); await open();
  expect(api.fullFiles).toHaveLength(1); expect(dock()).toBeNull();
  await act(async () => api.returnToTerm());
  expect(dock()).toBeNull(); expect(editor().dataset.visible).toBe("false");
  await act(async () => api.open("/notes/A.md", "A.md", undefined, "panel"));
  expect(dock().dataset.expanded).toBe("true");
  expect(api.notes.preferredMode).toBe("tab");
});
