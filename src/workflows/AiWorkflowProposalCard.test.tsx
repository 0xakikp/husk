// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { AiWorkflowProposal } from "../ai/workflowProposals";
import { AiWorkflowProposalCard } from "./AiWorkflowProposalCard";
import { clearWorkflowCaptureRequest, getWorkflowCaptureRequest } from "./captureRequest";

let root: Root; let container: HTMLDivElement;
const proposal: AiWorkflowProposal = { name: "Check project", description: "Review before publishing", steps: ["  pnpm lint  ", "pnpm test", "pnpm test"], stepTitles: ["Lint", "Test", "Retest"], stopOnError: true };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearWorkflowCaptureRequest(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearWorkflowCaptureRequest(); });
const render = async (value = proposal, disabled = false) => { await act(async () => root.render(createElement(AiWorkflowProposalCard, { proposal: value, disabled }))); };

it("renders an inert ordered preview with exact commands, titles, and shell semantics", async () => {
  await render();
  expect(container.querySelector("h4")?.textContent).toBe(proposal.name);
  expect(container.textContent).toContain(proposal.description);
  expect(container.textContent).toContain("3 steps");
  expect([...container.querySelectorAll("ol pre")].map((node) => node.textContent)).toEqual(proposal.steps);
  expect([...container.querySelectorAll(".ai-workflow-proposal-step-title")].map((node) => node.textContent)).toEqual(proposal.stepTitles);
  expect(container.textContent).toContain("Draft only · review before saving or running");
  expect(container.textContent).toContain("POSIX sh · stops on failure · no interactive aliases");
  expect(container.querySelector(".ai-workflow-proposal-shell")?.getAttribute("title")).toContain("functions are not inherited");
  expect(getWorkflowCaptureRequest()).toBeNull();
});

it("opens only the existing local capture review and preserves proposal metadata and duplicate steps", async () => {
  await render();
  expect(container.querySelectorAll("button")).toHaveLength(1);
  expect(container.querySelector("button")?.textContent).toBe("Review workflow…");
  await act(async () => container.querySelector("button")!.click());
  expect(getWorkflowCaptureRequest()).toMatchObject({ source: "ai-code", name: proposal.name, description: proposal.description, steps: proposal.steps, stepTitles: proposal.stepTitles });
  expect(getWorkflowCaptureRequest()?.selectedIndices).toBeUndefined();
  expect(getWorkflowCaptureRequest()?.steps).not.toBe(proposal.steps);
});

it("cannot open review while the proposal is disabled or streaming", async () => {
  await render(proposal, true);
  expect(container.querySelector("button")?.disabled).toBe(true);
  await act(async () => container.querySelector("button")!.click());
  expect(getWorkflowCaptureRequest()).toBeNull();
  await render(proposal, false);
  await act(async () => container.querySelector("button")!.click());
  expect(getWorkflowCaptureRequest()?.steps).toEqual(proposal.steps);
});

it("handles a single-step preview without optional titles or description", async () => {
  const one: AiWorkflowProposal = { name: "Status", steps: ["git status"], stopOnError: true };
  await render(one);
  expect(container.textContent).toContain("1 step");
  expect(container.querySelector(".ai-workflow-proposal-description")).toBeNull();
  expect(container.querySelector(".ai-workflow-proposal-step-title")).toBeNull();
  await act(async () => container.querySelector("button")!.click());
  expect(getWorkflowCaptureRequest()).not.toHaveProperty("description");
  expect(getWorkflowCaptureRequest()).not.toHaveProperty("stepTitles");
});

it("renders model-provided names, descriptions, titles, and commands as text only", async () => {
  await render({ name: "<img src=x onerror=run()>", description: "<script>run()</script>", steps: ["<script>execute()</script>"], stepTitles: ["<img src=y>"], stopOnError: true });
  expect(container.querySelector("script,img")).toBeNull();
  expect(container.querySelector("pre")?.textContent).toBe("<script>execute()</script>");
});
