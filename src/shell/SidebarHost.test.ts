// @vitest-environment happy-dom
import { act, createElement, useEffect, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Prefs } from "../settings/preferences";
import type { SidebarViewId } from "../sidebar/SidebarRail";

const lifecycle = vi.hoisted(() => ({ mounted: vi.fn(), unmounted: vi.fn() }));

function Probe({ name, active }: { name: string; active?: boolean }) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    lifecycle.mounted(name);
    return () => lifecycle.unmounted(name);
  }, [name]);
  return createElement("section", { "data-view": name, "data-active": String(active) },
    createElement("input", { value: draft, "aria-label": `${name} state`, onChange: (event) => setDraft(event.currentTarget.value) }),
    createElement("button", { onClick: () => setDraft("retained selection") }, "Set selection"));
}

vi.mock("../explorer/FileExplorer", () => ({ FileExplorer: () => createElement(Probe, { name: "explorer" }) }));
vi.mock("../sidebar/SidebarRail", () => ({ SidebarRail: () => createElement("nav", { "aria-label": "Sidebar sections" }) }));
vi.mock("../tools-hub/stageLocalToolCommand", () => ({ stageLocalToolCommandWithNotice: vi.fn() }));
vi.mock("../git/SourceControlPanel", () => ({ SourceControlPanel: () => createElement(Probe, { name: "source-control" }) }));
vi.mock("../remotes/RemotesView", () => ({ RemotesView: () => createElement(Probe, { name: "remotes" }) }));
vi.mock("../workflows/RunbooksDialog", () => ({ RunbooksDialog: ({ active }: { active: boolean }) => createElement(Probe, { name: "workflows", active }) }));
vi.mock("../tools-hub/ToolsHubView", () => ({ ToolsHubView: ({ active }: { active: boolean }) => createElement(Probe, { name: "tools-hub", active }) }));
vi.mock("../kubernetes/KubernetesView", () => ({ KubernetesView: () => createElement(Probe, { name: "kubernetes" }) }));
vi.mock("../docker/DockerView", () => ({ DockerView: ({ active }: { active: boolean }) => createElement(Probe, { name: "docker", active }) }));
vi.mock("../tailscale/TailscaleView", () => ({ TailscaleView: () => createElement(Probe, { name: "tailscale" }) }));
vi.mock("../notes/NotesView", () => ({ NotesView: () => createElement(Probe, { name: "vault" }) }));
vi.mock("../timeline/TimelineView", () => ({ TimelineView: () => createElement(Probe, { name: "timeline" }) }));

import { SidebarHost } from "./SidebarHost";

let root: Root;
let host: HTMLDivElement;
let props: ComponentProps<typeof SidebarHost>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  lifecycle.mounted.mockClear(); lifecycle.unmounted.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  props = {
    explorerOpen: true, explorerWidth: 260, sidebarView: "kubernetes",
    prefs: { panelGaps: 0 } as Prefs, bgDataUrl: null, activeFile: null, remoteHost: null,
    openFile: vi.fn(), openGitGraph: vi.fn(), openIssues: vi.fn(), openSftp: vi.fn(), openTotp: vi.fn(), openBrowser: vi.fn(),
    setSelectedK8sResource: vi.fn(), setSelectedDockerResource: vi.fn(), persistSidebarView: vi.fn(), cycleSidebarView: vi.fn(),
    setExplorerWidth: vi.fn(), persistSidebarWidth: vi.fn(), sidebarMinWidth: 200, sidebarMaxWidth: 600,
    typeInActiveTerminal: vi.fn(),
  };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function render(changes: Partial<typeof props> = {}) {
  props = { ...props, ...changes };
  await act(async () => { root.render(createElement(SidebarHost, props)); });
}
const view = (name: SidebarViewId) => host.querySelector<HTMLElement>(`[data-view="${name}"]`);
const panel = () => host.querySelector<HTMLElement>("#husk-sidebar-panel")!;

it("does not mount the remembered view or other tools while initially collapsed", async () => {
  await render({ explorerOpen: false });
  expect(lifecycle.mounted).not.toHaveBeenCalled();
  expect(panel().style.display).toBe("none");
  expect(host.querySelector('[aria-label="Resize sidebar"]')).toBeNull();
  await render({ sidebarView: "docker" });
  expect(lifecycle.mounted).not.toHaveBeenCalled();
  await render({ explorerOpen: true });
  expect(lifecycle.mounted).toHaveBeenCalledExactlyOnceWith("docker");
  expect(view("kubernetes")).toBeNull();
  expect(panel().style.display).toBe("");
});

it("preserves view identity, selection state and scroll across Files visits and complete sidebar collapse", async () => {
  await render();
  const kubernetes = view("kubernetes")!;
  await act(async () => kubernetes.querySelector("button")!.click());
  kubernetes.scrollTop = 120;
  await render({ sidebarView: "explorer" });
  expect(kubernetes.parentElement!.style.display).toBe("none");
  await render({ explorerOpen: false });
  expect(panel().style.display).toBe("none");
  expect(lifecycle.unmounted).not.toHaveBeenCalled();
  await render({ explorerOpen: true, sidebarView: "kubernetes" });
  expect(view("kubernetes")).toBe(kubernetes);
  expect(kubernetes.querySelector("input")!.value).toBe("retained selection");
  expect(kubernetes.scrollTop).toBe(120);
  expect(kubernetes.parentElement!.style.display).toBe("");
  expect(lifecycle.mounted.mock.calls.map(([name]) => name)).toEqual(["kubernetes", "explorer"]);
});

it("does not mount a newly selected view until a collapsed sidebar is reopened", async () => {
  await render();
  await render({ explorerOpen: false, sidebarView: "docker" });
  expect(view("docker")).toBeNull();
  expect(lifecycle.unmounted).not.toHaveBeenCalled();
  await render({ explorerOpen: true });
  expect(view("docker")).not.toBeNull();
  expect(view("kubernetes")).not.toBeNull();
});

it.each(["docker", "tools-hub", "workflows"] as const)("suspends active-only work in %s while collapsed or another view is selected", async (sidebarView) => {
  await render({ sidebarView });
  const activeView = view(sidebarView)!;
  expect(activeView.dataset.active).toBe("true");
  await render({ explorerOpen: false });
  expect(activeView.dataset.active).toBe("false");
  await render({ explorerOpen: true });
  expect(activeView.dataset.active).toBe("true");
  await render({ sidebarView: "explorer" });
  expect(activeView.dataset.active).toBe("false");
  expect(lifecycle.unmounted).not.toHaveBeenCalled();
});

it("removes the resize handle while collapsed and restores its keyboard behavior on reopening", async () => {
  await render();
  await render({ explorerOpen: false });
  expect(host.querySelector('[role="separator"]')).toBeNull();
  await render({ explorerOpen: true });
  const resize = host.querySelector('[role="separator"]')!;
  await act(async () => { resize.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
  expect(props.setExplorerWidth).toHaveBeenCalledExactlyOnceWith(284);
  expect(props.persistSidebarWidth).toHaveBeenCalledExactlyOnceWith(284);
});
