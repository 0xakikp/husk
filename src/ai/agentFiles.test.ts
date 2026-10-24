import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { saveAiAgentChanges } from "./agentFiles";
import { builtInAiAgents, type AiAgent } from "../settings/preferences";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("../settings/nativeConfig", () => ({ persistNativeConfigSection: vi.fn(), subscribeNativeConfigDocument: vi.fn(() => () => {}) }));
const agent = (id = "fixture"): AiAgent => ({ id, name: id, icon: "🤖", systemPrompt: "Fixture instructions", builtIn: false });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(invoke).mockResolvedValue(undefined); });

describe("scoped agent file writes", () => {
  it("does not read/reconcile/delete unrelated files when one agent changes", async () => {
    const before = [agent("changed"), agent("untouched")];
    await saveAiAgentChanges(before, [{ ...before[0], systemPrompt: "Edited instructions" }, before[1]]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("agent_write", { agent: expect.objectContaining({ id: "changed", systemPrompt: "Edited instructions" }) });
  });
  it("makes no calls for equivalent agents or untouched shipped defaults", async () => {
    const before = [...builtInAiAgents(), agent()];
    await saveAiAgentChanges(before, before.map((value) => ({ ...value })));
    expect(invoke).not.toHaveBeenCalled();
  });
  it("adds only the new agent and never reconciles the folder", async () => {
    await saveAiAgentChanges([agent("existing")], [agent("existing"), agent("added")]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_write", { agent: agent("added") });
  });
  it("removes only the explicitly removed custom agent", async () => {
    await saveAiAgentChanges([agent("remove"), agent("keep")], [agent("keep")]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_delete", { id: "remove" });
  });
  it("restores a built-in by deleting only its local override", async () => {
    const shipped = builtInAiAgents()[0];
    await saveAiAgentChanges([{ ...shipped, systemPrompt: "Local override" }, agent("keep")], [shipped, agent("keep")]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_delete", { id: shipped.id });
  });
  it("creates a built-in override without changing its shipped definition", async () => {
    const shipped = builtInAiAgents()[0];
    const custom = { ...shipped, systemPrompt: "Local override" };
    await saveAiAgentChanges([shipped], [custom]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_write", { agent: custom });
    expect(builtInAiAgents()[0].systemPrompt).toBe(shipped.systemPrompt);
  });
  it("propagates write failures and does not continue into deletions", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Disk full"));
    await expect(saveAiAgentChanges([agent("remove")], [agent("new")])).rejects.toThrow("Disk full");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_write", { agent: agent("new") });
  });
});
