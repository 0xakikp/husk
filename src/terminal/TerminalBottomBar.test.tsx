// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({
  status: { state: "ready" } as { state: string }, logs: vi.fn(() => true), copy: vi.fn(), vitals: vi.fn(),
  isRepo: vi.fn(), statusFiles: vi.fn(), branch: vi.fn(), counts: vi.fn(), send: vi.fn(), sourceControl: vi.fn(),
}));
vi.mock("./registry", () => ({ getSessionStatus: () => fixtures.status, subscribeSessionStatus: () => () => {}, openTerminalLogs: fixtures.logs }));
vi.mock("../settings/preferences", () => ({ usePrefs: () => ({ panelShadows: false }) }));
vi.mock("../git/client", () => ({ isRepo: fixtures.isRepo, status: fixtures.statusFiles, currentBranch: fixtures.branch, branchAheadBehind: fixtures.counts }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: fixtures.copy }));
vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("./vitals/useSystemVitals", () => ({ useSystemVitals: (enabled: boolean) => fixtures.vitals(enabled) }));
// Test bar decisions independently from Radix positioning, checked in browser.
vi.mock("../components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Context = React.createContext({ open: false, onOpenChange: (_open: boolean) => {} });
  return {
    DropdownMenu: ({ children, open, onOpenChange }: any) => <Context.Provider value={{ open, onOpenChange }}>{children}</Context.Provider>,
    DropdownMenuTrigger: ({ children }: any) => { const c = React.useContext(Context); return React.cloneElement(children, { onClick: () => c.onOpenChange(!c.open) }); },
    DropdownMenuContent: ({ children, className }: any) => React.useContext(Context).open ? <div role="menu" className={className}>{children}</div> : null,
    DropdownMenuLabel: ({ children }: any) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({ children, onSelect }: any) => <button role="menuitem" onClick={onSelect}>{children}</button>,
    DropdownMenuCheckboxItem: ({ children, checked, onCheckedChange, onSelect: _onSelect, ...props }: any) => <button {...props} role="menuitemcheckbox" aria-checked={checked} onClick={() => onCheckedChange(!checked)}>{children}</button>,
  };
});
import { TerminalBottomBar } from "./TerminalBottomBar";
import { initializeTerminalStatus, observeTerminalStatusScope, observeTerminalStatusPrompt, startTerminalStatusCommand, completeTerminalStatusCommand, disposeTerminalStatus } from "./statusBarState";
import { updateStatusBarPreferences } from "./statusBarPreferences";
let root: Root, host: HTMLDivElement;
function local(leaf: number, cwd = "/work/husk") {
  initializeTerminalStatus(leaf, `session-${leaf}`);
  observeTerminalStatusScope(leaf, { observedHost: null, isRemote: false, remoteTarget: null, cwd });
  observeTerminalStatusPrompt(leaf, true);
}
function remote(leaf: number, cwd?: string) {
  observeTerminalStatusScope(leaf, { observedHost: cwd ? "server" : undefined, isRemote: true, remoteTarget: "houseofaki", cwd, boundary: true });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks();
  fixtures.vitals.mockReturnValue(null);
  fixtures.status = { state: "ready" }; fixtures.isRepo.mockResolvedValue(true); fixtures.statusFiles.mockResolvedValue([{}]);
  fixtures.branch.mockResolvedValue("main"); fixtures.counts.mockResolvedValue({ ahead: 2, behind: 0 }); fixtures.copy.mockResolvedValue(undefined);
  updateStatusBarPreferences({ pinned: [], machineMetrics: false }); local(1); local(2, "/other");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); disposeTerminalStatus(1); disposeTerminalStatus(2); });
async function render(leafId: number | null = 1) { await act(async () => root.render(<TerminalBottomBar leafId={leafId} onSendToTerminal={fixtures.send} onOpenSourceControl={fixtures.sourceControl} />)); }
async function click(selector: string) { const button = host.querySelector<HTMLButtonElement>(selector)!; expect(button).not.toBeNull(); await act(async () => button.click()); }

it("shows local prompt, folder and Git without unrelated installed tools", async () => {
  await render(); expect(host.textContent).toContain("Ready"); expect(host.textContent).toContain("Local");
  expect(host.textContent).toContain("husk"); expect(host.textContent).toContain("main"); expect(host.textContent).toContain("1 changes");
  expect(host.querySelectorAll(".terminal-status__tool")).toHaveLength(0);
  expect(fixtures.isRepo).toHaveBeenCalledWith("/work/husk"); expect(fixtures.vitals).toHaveBeenLastCalledWith(false);
});
it("does not treat remote paths as local Git paths, even when they match a local folder", async () => {
  remote(1, "/work/husk"); await render(); expect(host.textContent).toContain("Remote: server");
  expect(host.querySelector(".terminal-status__git")).toBeNull(); expect(fixtures.isRepo).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Local"); expect(fixtures.send).not.toHaveBeenCalled();
});
it("immediately drops local cwd/Git when entering SSH before remote metadata arrives", async () => {
  await render(); expect(host.querySelector(".terminal-status__git")).not.toBeNull();
  await act(async () => remote(1)); expect(host.textContent).toContain("Remote: houseofaki");
  expect(host.querySelector(".terminal-status__directory, .terminal-status__git")).toBeNull();
  await click(".terminal-status__more"); expect(host.textContent).toContain("Remote folder not reported");
});
it("keeps unknown provenance unknown without issuing local Git reads", async () => {
  initializeTerminalStatus(1, "new-session"); await render(); expect(host.textContent).toContain("Scope unverified");
  expect(host.textContent).toContain("Shell open"); expect(fixtures.isRepo).not.toHaveBeenCalled();
  expect(host.querySelector(".terminal-status__directory")).toBeNull();
});
it("does not leak a command, failure, duration or open menu into another pane", async () => {
  startTerminalStatusCommand(1, "some-command", 1000); completeTerminalStatusCommand(1, 128, 6000); await render();
  expect(host.textContent).toContain("Failed (128)"); expect(host.textContent).toContain("5s"); await click(".terminal-status__more");
  await render(2); expect(host.textContent).toContain("Ready"); expect(host.textContent).not.toContain("some-command");
  expect(host.textContent).not.toContain("5s"); expect(host.querySelector('[role="menu"]')).toBeNull();
  await render(1); expect(host.textContent).toContain("Failed (128)");
});
it("ignores late Git responses from the previous terminal scope", async () => {
  let resolveBranch!: (branch: string) => void;
  fixtures.branch.mockReturnValue(new Promise((resolve) => { resolveBranch = resolve; }));
  await render(); await act(async () => remote(1)); await act(async () => resolveBranch("stale-local-branch"));
  expect(host.textContent).not.toContain("stale-local-branch"); expect(host.querySelector(".terminal-status__git")).toBeNull();
});
it("shows a meaningful target only while its command is running, with last details in the menu", async () => {
  startTerminalStatusCommand(1, "kubectl --context staging get pods", Date.now()); await render();
  expect(host.querySelectorAll(".terminal-status__tool")).toHaveLength(1);
  const tool = host.querySelector<HTMLSpanElement>('.terminal-status__tool[data-tool="kubernetes"]')!;
  expect(tool.textContent).toContain("K8s·context: staging");
  expect(tool.title).toContain("staging"); expect(tool.title).toContain("not necessarily the next one");
  expect(tool.tagName).toBe("SPAN");
  await act(async () => { completeTerminalStatusCommand(1, 0, Date.now()); observeTerminalStatusPrompt(1, true); });
  expect(host.querySelector(".terminal-status__tools")).toBeNull();
  await click(".terminal-status__more");
  expect(host.querySelector('[aria-label="Pin Kubernetes"]')?.textContent).toContain("Last context: staging");
  await act(async () => startTerminalStatusCommand(1, "ls", Date.now())); expect(host.querySelector(".terminal-status__tool")).toBeNull();
});
it("keeps pins in the menu without adding empty bar labels or querying a target", async () => {
  await render(); await click(".terminal-status__more");
  expect(host.textContent).not.toContain("Pinned by you");
  expect(host.textContent).toContain("Unverified");
  const pin = host.querySelector<HTMLButtonElement>('[aria-label="Pin Docker"]')!;
  await act(async () => pin.click()); expect(pin.getAttribute("title")).toContain("target unverified");
  expect(host.querySelector(".terminal-status__tools")).toBeNull();
  await render(2); expect(host.querySelector(".terminal-status__tools")).toBeNull();
  await click(".terminal-status__more");
  expect(host.querySelector('[aria-label="Pin Docker"]')?.getAttribute("aria-checked")).toBe("true");
  expect(host.querySelector('[role="menuitemcheckbox"]')?.getAttribute("aria-label")).toBe("Pin Docker");
  expect(host.querySelector('.terminal-status__tools button')).toBeNull();
  expect(fixtures.send).not.toHaveBeenCalled(); expect(localStorage.getItem("husk.terminal.statusbar.v1")).not.toContain("houseofaki");
});
it("starts machine metrics only on explicit display and clearly labels the computer", async () => {
  remote(1); await render(); expect(fixtures.vitals).toHaveBeenLastCalledWith(false);
  await click(".terminal-status__more"); expect(fixtures.vitals).toHaveBeenLastCalledWith(true);
  expect(host.textContent).toContain("This computer"); expect(host.textContent).toContain("Not the remote host");
  await click(".terminal-status__more"); expect(fixtures.vitals).toHaveBeenLastCalledWith(false);
});
it("opens logs for the displayed leaf and copies only the observed directory", async () => {
  await render(2); await click(".terminal-status__state"); expect(fixtures.logs).toHaveBeenCalledWith(2);
  await click(".terminal-status__directory"); expect(fixtures.copy).toHaveBeenCalledWith("/other"); expect(fixtures.send).not.toHaveBeenCalled();
});
it("shows real connection errors instead of Ready", async () => {
  fixtures.status = { state: "disconnected" }; await render(); expect(host.textContent).toContain("Disconnected");
  expect(host.textContent).not.toContain("Ready"); expect(fixtures.isRepo).not.toHaveBeenCalled();
});
it("reports an observed command start even when its command text is unavailable", async () => {
  startTerminalStatusCommand(1, "", Date.now()); await render();
  expect(host.textContent).toContain("Running"); expect(fixtures.isRepo).not.toHaveBeenCalled();
});
it("does not expose sensitive command arguments in visible labels or tooltips", async () => {
  startTerminalStatusCommand(1, "aws --profile prod configure --password super-secret", Date.now()); await render();
  expect(host.innerHTML).not.toContain("super-secret"); expect(host.innerHTML).not.toContain("Current command profile: prod");
  expect(host.querySelector(".terminal-status__tools")).toBeNull();
});
it("keeps other cloud CLI activity in the menu without bare labels or guessed targets", async () => {
  startTerminalStatusCommand(1, "az account show --subscription private-subscription", Date.now()); await render();
  expect(host.querySelector(".terminal-status__tools")).toBeNull();
  await click(".terminal-status__more");
  expect(host.querySelector('[aria-label="Pin Azure"]')?.textContent).toContain("Current command · activity only");
  expect(host.querySelector('[role="menu"]')?.textContent).not.toContain("private-subscription");
  await render(2); expect(host.querySelector('[data-tool="cli:az"]')).toBeNull();
  expect(fixtures.send).not.toHaveBeenCalled();
});
it("pins a directly used custom CLI across panes without persisting its arguments", async () => {
  startTerminalStatusCommand(1, "env MODE=check /opt/bin/teamctl status --target internal-cluster", Date.now()); await render();
  await click(".terminal-status__more"); await click('[aria-label="Pin teamctl"]');
  expect(localStorage.getItem("husk.terminal.statusbar.v1")).toContain("cli:teamctl");
  expect(localStorage.getItem("husk.terminal.statusbar.v1")).not.toMatch(/internal-cluster|MODE|\/opt/);
  await render(2); expect(host.querySelector(".terminal-status__tools")).toBeNull();
  await click(".terminal-status__more");
  expect(host.querySelector('[aria-label="Pin teamctl"]')?.textContent).toContain("Pinned · activity only");
  await click('[aria-label="Pin teamctl"]'); expect(host.querySelector('[aria-label="Pin teamctl"]')).toBeNull();
});
it("does not add generic tools from a redacted command to the menu", async () => {
  startTerminalStatusCommand(1, "custom-client --password secret-value", Date.now()); await render();
  await click(".terminal-status__more");
  expect(host.querySelector('[aria-label="Pin custom-client"]')).toBeNull();
  expect(host.innerHTML).not.toContain("secret-value");
});
it("renders MiB native memory measurements as GiB, not thousands of GB", async () => {
  fixtures.vitals.mockReturnValue({ cpu_percent: 22, mem_used_mb: 22528, mem_total_mb: 32768 });
  await render(); await click(".terminal-status__more");
  expect(host.textContent).toContain("CPU 22% · RAM 22.0 / 32.0 GiB");
});
it("does not show pinned tools at idle or for bare running commands", async () => {
  updateStatusBarPreferences({ pinned: ["kubernetes", "docker", "aws", "terraform", "cli:az"], machineMetrics: false });
  await render(); expect(host.querySelector(".terminal-status__tools")).toBeNull();
  for (const command of ["kubectl get pods", "docker ps", "aws sts get-caller-identity", "terraform plan", "az account show"]) {
    await act(async () => startTerminalStatusCommand(1, command, Date.now()));
    expect(host.querySelector(".terminal-status__tools")).toBeNull();
  }
});
it.each([
  ["aws --profile dev sts get-caller-identity", "AWS·profile: dev"],
  ["AWS_PROFILE=dev aws sts get-caller-identity", "AWS·profile: dev"],
  ["DOCKER_CONTEXT=staging docker ps", "Docker·context: staging"],
  ["TF_WORKSPACE=stage terraform plan", "Terraform·workspace: stage"],
  ["helm --kube-context dev list", "K8s·context: dev"],
])("shows explicit values without inventing flag provenance for %s", async (command, label) => {
  startTerminalStatusCommand(1, command, Date.now()); await render();
  expect(host.querySelector(".terminal-status__tool")?.textContent).toBe(label);
  expect(fixtures.send).not.toHaveBeenCalled();
});
it.each([
  "kubectl --context prod get pods && kubectl --context staging get svc",
  "kubectl --context prod get pods && kubectl get svc",
  "kubectl get pods && kubectl --context prod get svc",
])("does not claim a single target for mixed command overrides: %s", async (command) => {
  startTerminalStatusCommand(1, command, Date.now()); await render();
  expect(host.querySelector(".terminal-status__tools")).toBeNull();
  await click(".terminal-status__more"); expect(host.textContent).toContain("Mixed / unknown targets");
});
it("shows one badge for repeated consistent overrides in a compound command", async () => {
  startTerminalStatusCommand(1, "kubectl --context dev get pods && kubectl --context dev get svc", Date.now()); await render();
  expect(host.querySelectorAll(".terminal-status__tool")).toHaveLength(1);
  expect(host.querySelector(".terminal-status__tool")?.textContent).toContain("context: dev");
});
it("does not keep a target badge when disconnected even if its command was running", async () => {
  startTerminalStatusCommand(1, "aws --profile prod sts get-caller-identity", Date.now());
  fixtures.status = { state: "disconnected" }; await render();
  expect(host.querySelector(".terminal-status__tools")).toBeNull();
});
it("does not derive tool values beyond the command redaction limit", async () => {
  startTerminalStatusCommand(1, `echo ${"a".repeat(480)}; aws --profile hidden-value --password secret-value sts get-caller-identity`, Date.now()); await render();
  await click(".terminal-status__more");
  expect(host.querySelector(".terminal-status__tools")).toBeNull();
  expect(host.innerHTML).not.toMatch(/hidden-value|secret-value/);
});
