// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirm } from "@tauri-apps/plugin-dialog";
import { PromptsFile } from "./PromptsFile";
import { confirmSettingsNavigation } from "../settingsDrafts";
import { commitNativeConfigSections, type HuskConfigDocument } from "../nativeConfig";
import { type PromptTemplate } from "../preferences";

const fixture = vi.hoisted(() => ({ templates: [] as PromptTemplate[], listeners: new Set<() => void>() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }));
vi.mock("../../toast", () => ({ toast: vi.fn() }));
vi.mock("../nativeConfig", () => ({ commitNativeConfigSections: vi.fn() }));
vi.mock("../preferences", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    usePrefs: () => ({ aiPromptTemplates: useSyncExternalStore((listener) => { fixture.listeners.add(listener); return () => fixture.listeners.delete(listener); }, () => fixture.templates) }),
    getPrefs: () => ({ aiPromptTemplates: fixture.templates }),
    preferencesForNativeConfig: (value: unknown) => value,
  };
});
let container: HTMLDivElement;
let root: Root;
const initial = (): PromptTemplate => ({ id: "existing", label: "Existing", icon: "✨", prompt: "Original prompt" });
function publish(templates: PromptTemplate[]) { fixture.templates = templates; for (const listener of fixture.listeners) listener(); }
function saved(sections: Partial<Omit<HuskConfigDocument, "config_version">>): HuskConfigDocument {
  const templates = sections.preferences?.aiPromptTemplates as PromptTemplate[];
  publish(templates);
  return { config_version: 1, preferences: sections.preferences ?? {}, ai: {}, mcp: {}, appearance_presets: {} };
}
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.templates = [initial()];
  vi.mocked(confirm).mockResolvedValue(false);
  vi.mocked(commitNativeConfigSections).mockImplementation(async (sections) => saved(sections));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<PromptsFile />));
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
async function addDraft() { await click("+ add template"); await change("Label", "New template"); await change("Prompt text", "Draft prompt"); }

describe("prompt template drafts", () => {
  it("validates label and prompt inline before saving", async () => {
    await click("+ add template"); await click("add template");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Enter a label");
    await change("Label", "New template"); await click("add template");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Enter prompt text");
    expect(commitNativeConfigSections).not.toHaveBeenCalled();
  });

  it("keeps a draft after declined Back/Cancel and guards category navigation", async () => {
    await addDraft(); await click("all templates");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((container.querySelector('[placeholder="Prompt text"]') as HTMLTextAreaElement).value).toBe("Draft prompt");
    expect(await confirmSettingsNavigation()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
    vi.mocked(confirm).mockResolvedValueOnce(true);
    await click("cancel");
    expect(container.querySelector('[aria-label="Prompt templates"]')).toBeTruthy();
    expect(commitNativeConfigSections).not.toHaveBeenCalled();
    expect(await confirmSettingsNavigation()).toBe(true);
  });

  it("does not prompt to abandon an untouched form", async () => {
    await click("+ add template"); await click("all templates");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("preserves failed drafts and retries with the same ID without duplicates", async () => {
    await addDraft();
    vi.mocked(commitNativeConfigSections).mockRejectedValueOnce(new Error("Disk full"));
    await click("add template");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Disk full");
    expect((container.querySelector('[placeholder="Prompt text"]') as HTMLTextAreaElement).value).toBe("Draft prompt");
    expect(fixture.templates).toEqual([initial()]);
    const first = vi.mocked(commitNativeConfigSections).mock.calls[0][0].preferences!.aiPromptTemplates as PromptTemplate[];
    await click("add template");
    const second = vi.mocked(commitNativeConfigSections).mock.calls[1][0].preferences!.aiPromptTemplates as PromptTemplate[];
    expect(first[1].id).toBe(second[1].id);
    expect(fixture.templates).toHaveLength(2);
    expect(container.querySelector('[placeholder="Prompt text"]')).toBeNull();
    expect(await confirmSettingsNavigation()).toBe(true);
  });

  it("discards a failed draft without enqueuing or applying it", async () => {
    await addDraft();
    vi.mocked(commitNativeConfigSections).mockRejectedValueOnce(new Error("Disk full"));
    await click("add template");
    vi.mocked(confirm).mockResolvedValueOnce(true);
    await click("cancel");
    expect(fixture.templates).toEqual([initial()]);
    expect(commitNativeConfigSections).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("locks edits and navigation until durable saving completes", async () => {
    await addDraft();
    let complete!: () => void;
    vi.mocked(commitNativeConfigSections).mockImplementationOnce((sections) => new Promise((resolve) => { complete = () => resolve(saved(sections)); }));
    await click("add template");
    expect(container.querySelector("fieldset")!.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Saving prompt");
    expect(await confirmSettingsNavigation()).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => complete());
    expect(container.querySelector("fieldset")!.disabled).toBe(false);
    expect(await confirmSettingsNavigation()).toBe(true);
  });

  it("preserves unrelated templates and retains edited drafts when the source is removed elsewhere", async () => {
    await click("/Existing"); await click("edit"); await change("Prompt text", "Edited draft");
    await act(async () => publish([{ ...initial(), id: "other", label: "Other" }]));
    expect((container.querySelector('[placeholder="Prompt text"]') as HTMLTextAreaElement).value).toBe("Edited draft");
    await click("save changes");
    expect(fixture.templates).toEqual(expect.arrayContaining([expect.objectContaining({ id: "other" }), expect.objectContaining({ id: "existing", prompt: "Edited draft" })]));
  });

  it("keeps a template present when a delete fails to save", async () => {
    await click("/Existing");
    vi.mocked(commitNativeConfigSections).mockRejectedValueOnce(new Error("Read-only config"));
    await click("delete");
    expect(fixture.templates).toEqual([initial()]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Read-only config");
  });
});
