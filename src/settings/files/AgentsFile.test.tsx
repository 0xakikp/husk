// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirm } from "@tauri-apps/plugin-dialog";
import { AgentsFile } from "./AgentsFile";
import { confirmSettingsNavigation } from "../settingsDrafts";
import { saveAiAgentChanges } from "../../ai/agentFiles";
import { setPrefs, type AiAgent, type Prefs } from "../preferences";

const fixture = vi.hoisted(() => ({ prefs: {} as Prefs, listeners: new Set<() => void>() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }));
vi.mock("../../toast", () => ({ toast: vi.fn() }));
vi.mock("../../ai/agentFiles", () => ({ saveAiAgentChanges: vi.fn() }));
vi.mock("../../ai/projectMemory", () => ({ getProjectMemory: () => "", setProjectMemory: vi.fn(), MAX_MEMORY_CHARS: 8192 }));
vi.mock("../../ai/huskContext", () => ({ MAX_GLOBAL_INSTRUCTIONS_CHARS: 32000, MAX_PERSONAL_MEMORY_CHARS: 32000 }));
vi.mock("../../workspace/store", () => ({ getWorkspaceRoot: () => null }));
vi.mock("../preferences", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    builtInAiAgents: () => [{ id: "code", name: "Code", icon: "💻", systemPrompt: "Shipped prompt", builtIn: true }],
    usePrefs: () => useSyncExternalStore((listener) => { fixture.listeners.add(listener); return () => fixture.listeners.delete(listener); }, () => fixture.prefs),
    getPrefs: () => fixture.prefs,
    setPrefs: vi.fn((patch: Partial<Prefs>) => { fixture.prefs = { ...fixture.prefs, ...patch }; for (const listener of fixture.listeners) listener(); }),
  };
});
let container: HTMLDivElement;
let root: Root;
const initial = (): AiAgent => ({ id: "existing", name: "Existing", icon: "🤖", systemPrompt: "Original prompt", builtIn: false });
function publish(agents: AiAgent[]) { fixture.prefs = { ...fixture.prefs, aiAgents: agents }; for (const listener of fixture.listeners) listener(); }
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.prefs = { aiAgents: [initial()], activeAgentId: "existing", aiResponseStyle: "concise", aiGlobalInstructions: "", aiPersonalMemory: "", aiContextBudgetKb: 32, aiDefaultIncludeTerminal: true, aiDefaultIncludeFile: true, aiDefaultIncludeSelection: true, aiFileToolsEnabled: true, aiMcpToolsEnabled: true } as Prefs;
  vi.mocked(confirm).mockResolvedValue(false);
  vi.mocked(saveAiAgentChanges).mockResolvedValue();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<AgentsFile />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); fixture.listeners.clear(); vi.unstubAllGlobals(); });
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
async function change(placeholder: string, value: string) {
  const element = container.querySelector(`[placeholder="${placeholder}"]`) as HTMLInputElement | HTMLTextAreaElement;
  expect(element).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function addDraft() { await click("+ add agent"); await change("Agent name", "New agent"); await change("You are the …", "Draft instructions"); }

describe("agent settings drafts", () => {
  it("requires name/instructions inline before any native write", async () => {
    await click("+ add agent"); await click("add agent");
    expect(container.textContent).toContain("Enter an agent name");
    expect(container.textContent).toContain("Add instructions");
    expect(saveAiAgentChanges).not.toHaveBeenCalled();
  });
  it.each([
    ["Agent name", "x".repeat(81), "at most 80"],
    ["You are the …", "😀".repeat(8001), "32,000 UTF-8 bytes"],
    ["🤖", "x".repeat(17), "at most 16"],
    ["Use global default", "x".repeat(257), "at most 256"],
  ])("checks the native/runtime limit for %s before saving", async (placeholder, value, error) => {
    await addDraft(); await change(placeholder, value); await click("add agent");
    expect(container.textContent).toContain(error);
    expect(saveAiAgentChanges).not.toHaveBeenCalled();
  });
  it("keeps dirty drafts on declined Back/Cancel and protects category navigation", async () => {
    await addDraft(); await click("all agents");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((container.querySelector('[placeholder="You are the …"]') as HTMLTextAreaElement).value).toBe("Draft instructions");
    expect(await confirmSettingsNavigation()).toBe(false);
    vi.mocked(confirm).mockResolvedValueOnce(true); await click("cancel");
    expect(container.querySelector('[aria-label="AI agents"]')).toBeTruthy();
    expect(saveAiAgentChanges).not.toHaveBeenCalled();
    expect(await confirmSettingsNavigation()).toBe(true);
  });
  it("does not prompt when leaving an untouched form", async () => {
    await click("+ add agent"); await click("all agents"); expect(confirm).not.toHaveBeenCalled();
  });
  it("keeps failed drafts and retries the same create ID without duplicates", async () => {
    await addDraft();
    vi.mocked(saveAiAgentChanges).mockRejectedValueOnce(new Error("Disk full"));
    await click("add agent");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Disk full");
    expect(fixture.prefs.aiAgents).toEqual([initial()]);
    expect(setPrefs).not.toHaveBeenCalled();
    const first = vi.mocked(saveAiAgentChanges).mock.calls[0][1][1].id;
    await click("add agent");
    expect(vi.mocked(saveAiAgentChanges).mock.calls[1][1][1].id).toBe(first);
    expect(fixture.prefs.aiAgents).toHaveLength(2);
    expect(container.querySelector('[placeholder="You are the …"]')).toBeNull();
  });
  it("discards failed drafts without committing them to runtime", async () => {
    await addDraft(); vi.mocked(saveAiAgentChanges).mockRejectedValueOnce(new Error("Disk full")); await click("add agent");
    vi.mocked(confirm).mockResolvedValueOnce(true); await click("cancel");
    expect(fixture.prefs.aiAgents).toEqual([initial()]); expect(setPrefs).not.toHaveBeenCalled();
  });
  it("locks all actions and navigation during saving, then keeps concurrently edited agents", async () => {
    await addDraft();
    let complete!: () => void;
    vi.mocked(saveAiAgentChanges).mockImplementationOnce(() => new Promise<void>((resolve) => { complete = resolve; }));
    await click("add agent");
    expect(container.querySelector("fieldset")!.disabled).toBe(true);
    expect(await confirmSettingsNavigation()).toBe(false); expect(confirm).not.toHaveBeenCalled();
    await act(async () => { publish([{ ...initial(), systemPrompt: "External edit" }, { ...initial(), id: "foreign", name: "Foreign" }]); complete(); });
    expect(fixture.prefs.aiAgents).toEqual(expect.arrayContaining([expect.objectContaining({ id: "existing", systemPrompt: "External edit" }), expect.objectContaining({ id: "foreign" }), expect.objectContaining({ name: "New agent" })]));
    expect(await confirmSettingsNavigation()).toBe(true);
  });
  it("keeps the draft visible after its source is removed elsewhere, and can save it again", async () => {
    await click("Existing"); await click("edit"); await change("You are the …", "Edited instructions");
    await act(async () => publish([]));
    expect((container.querySelector('[placeholder="You are the …"]') as HTMLTextAreaElement).value).toBe("Edited instructions");
    await click("save changes");
    expect(saveAiAgentChanges).toHaveBeenCalledWith([], [expect.objectContaining({ id: "existing", systemPrompt: "Edited instructions" })]);
    expect(fixture.prefs.aiAgents).toHaveLength(1);
  });
  it("retains agents when deletion fails and keeps unrelated agents on successful deletion", async () => {
    await click("Existing");
    vi.mocked(saveAiAgentChanges).mockRejectedValueOnce(new Error("Read-only folder")); await click("delete");
    expect(fixture.prefs.aiAgents).toEqual([initial()]);
    vi.mocked(saveAiAgentChanges).mockImplementationOnce(async () => publish([initial(), { ...initial(), id: "foreign" }]));
    await click("delete");
    expect(fixture.prefs.aiAgents).toEqual([expect.objectContaining({ id: "foreign" })]);
  });
  it("keeps a duplicated long name within the persisted limit", async () => {
    await act(async () => publish([{ ...initial(), name: "n".repeat(80) }]));
    await click("n".repeat(80)); await click("duplicate");
    const copied = fixture.prefs.aiAgents.find((agent) => agent.id !== "existing")!;
    expect(copied.name.length).toBe(80); expect(copied.name).toMatch(/ Copy$/);
  });
});
