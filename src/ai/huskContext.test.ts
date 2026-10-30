import { expect, it, vi } from "vitest";
import type { AiAgent } from "../settings/preferences";
import type { Provider } from "./providers";

vi.mock("../settings/preferences", () => ({ getPrefs: () => ({ aiResponseStyle: "concise", aiFileToolsEnabled: false, aiMcpToolsEnabled: false }) }));
import { buildHuskAssistantContext } from "./huskContext";

const agent: AiAgent = { id: "code", name: "Code", icon: "✦", builtIn: true, systemPrompt: "Help with code." };
const api: Provider = { id: "example", label: "Example", kind: "openai-compatible", defaultModel: "example-model" };
const cli: Provider = { id: "example-cli", label: "Example CLI", kind: "cli", defaultModel: "example-cli-model", cli: "codex" };
const context = (workflowProposals?: boolean, provider = api) => buildHuskAssistantContext({ agent, provider, model: provider.defaultModel, workflowProposals });

it("only enables machine-readable workflow proposals for surfaces that can review them", () => {
  expect(context()).not.toContain("husk-workflow");
  expect(context(false)).not.toContain("husk-workflow");
  expect(context(true)).toContain("husk-workflow");
});

it.each([api, cli])("offers the same inert workflow format with $label", (provider) => {
  const prompt = context(true, provider);
  expect(prompt).toContain('"version":1');
  expect(prompt).toContain('"steps":["pnpm lint","pnpm test"]');
  expect(prompt).toContain('"stopOnError":true');
  expect(prompt).toContain("one complete command line");
  expect(prompt).toContain("do not invent saved workflow contents or IDs");
  expect(prompt).toContain("propose only the additional steps");
  expect(prompt).toContain("never automatically saves, appends, replaces, runs, or schedules");
  expect(prompt).toContain("requires a separate explicit user action");
});

it("explains ordered subprocess semantics, review limits, and meaningful use instead of every suggestion", () => {
  const prompt = context(true);
  expect(prompt).toContain("Do not turn unrelated alternatives or every single command into a workflow");
  expect(prompt).toContain("Do not repeat the same commands in ordinary shell fences");
  expect(prompt).toContain("POSIX sh subprocess");
  expect(prompt).toContain("not back into the user's terminal");
  expect(prompt).toContain("Interactive aliases and functions are not inherited");
  expect(prompt).toContain("long-running server or interactive command blocks following steps");
  expect(prompt).toContain("do not embed secret values or defaults");
  expect(prompt).toContain("saved workflow to append to");
});
