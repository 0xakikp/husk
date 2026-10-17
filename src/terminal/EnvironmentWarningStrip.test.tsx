// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  leaf: 80_912, ptyId: 1, scopeKnown: true, scopeToken: "scope-1", busy: false, draft: "", promptKnown: true,
  target: { ptyId: 1, isRemote: false, host: null as string | null, cwd: "/project" },
  focus: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("../ai/terminalTarget", () => ({
  captureTerminalTarget: () => ({ ...fixtures.target }),
  isCurrentTerminalTarget: (target: typeof fixtures.target) => Object.entries(target).every(([key, value]) =>
    key === "scopeToken" || fixtures.target[key as keyof typeof fixtures.target] === value),
}));
vi.mock("./registry", () => ({
  getSessionHandle: (leafId: number) => leafId !== fixtures.leaf ? null : {
    getPtyId: () => fixtures.ptyId,
    getStagingScope: () => fixtures.scopeKnown ? {
      token: fixtures.scopeToken, ptyId: fixtures.ptyId, cwd: "/project", isRemote: false, host: null,
    } : null,
    getPromptReadiness: () => fixtures.promptKnown && !fixtures.busy && !fixtures.draft
      ? { ready: true } : { ready: false, reason: "Prompt is not verified empty." },
    focus: fixtures.focus,
  },
}));
vi.mock("../toast", () => ({ toast: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { toast } from "../toast";
import { EnvironmentWarningStrip } from "./EnvironmentWarningStrip";
import { clearEnvironmentWarning, getEnvironmentWarning, recordEnvironmentWarning } from "./environmentWarnings";

const leaf = 80_912;
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(async () => undefined);
  Object.assign(fixtures, {
    ptyId: 1, scopeKnown: true, scopeToken: "scope-1", busy: false, draft: "", promptKnown: true,
    target: { ptyId: 1, isRemote: false, host: null, cwd: "/project" },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  clearEnvironmentWarning(leaf);
  clearEnvironmentWarning(leaf + 1);
  container.remove();
});

async function render(command: string, displayedLeaf: number | null = leaf) {
  await act(async () => {
    recordEnvironmentWarning(leaf, { command, cwd: "/project", at: 100 });
    root.render(<EnvironmentWarningStrip leafId={displayedLeaf} />);
  });
}
function verifyButton() {
  return [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === "verify context");
}

describe("environment warning inspection availability", () => {
  it.each([
    ["oci --profile prod compute instance terminate", "oci / prod"],
    ["az --subscription prod vm delete --name app", "azure / prod"],
    ["gcloud --project dev --configuration prod compute instances delete app", "gcloud / prod"],
    ["podman --connection prod rm app", "podman / prod"],
    ["orb -m prod rm app", "orbstack / prod"],
    ["orbctl run -m prod rm app", "orbstack / prod"],
    ["colima --profile prod stop", "colima / prod"],
  ])("never offers or stages an invented inspection for %s", async (command, label) => {
    await render(command);
    expect(container.textContent).toContain(label);
    expect(verifyButton()).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();

    const dismiss = container.querySelector<HTMLButtonElement>('[title="Acknowledge and dismiss environment warning"]');
    expect(dismiss).not.toBeNull();
    await act(async () => dismiss!.click());
    expect(getEnvironmentWarning(leaf)).toBeNull();
    expect(container.textContent).toBe("");
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["kubectl --context prod delete pod app", "kubectl config get-contexts 'prod'"],
    ["aws --profile prod ec2 stop-instances", "aws --profile 'prod' configure list"],
    ["docker --context prod system prune", "docker context inspect 'prod'"],
    ["TF_WORKSPACE=prod terraform apply", "TF_WORKSPACE='prod' terraform workspace show"],
  ])("keeps supported inspections click-to-stage without Enter: %s", async (command, inspection) => {
    await render(command);
    expect(invoke).not.toHaveBeenCalled();
    const verify = verifyButton();
    expect(verify).toBeDefined();
    expect(verify!.title).toBe(`Stage: ${inspection}`);
    await act(async () => verify!.click());
    expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_write", { id: 1, data: inspection });
    expect(inspection).not.toMatch(/[\r\n]/);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Context check staged", variant: "info" }));
    expect(getEnvironmentWarning(leaf)).not.toBeNull();
  });

  it.each([
    { busy: true }, { draft: "rm old" }, { promptKnown: false },
  ])("refuses an unsafe prompt state %j rather than announcing success", async (change) => {
    await render("docker --context prod system prune");
    Object.assign(fixtures, change);
    await act(async () => verifyButton()!.click());
    expect(invoke).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "Could not stage context check", variant: "error" }));
  });

  it("keeps an initially unknown target unavailable rather than adopting a later terminal", async () => {
    fixtures.scopeKnown = false;
    await render("docker --context prod system prune");
    fixtures.scopeKnown = true;
    await act(async () => root.render(<EnvironmentWarningStrip leafId={leaf} />));
    await act(async () => verifyButton()!.click());
    expect(invoke).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Could not stage context check", message: expect.stringContaining("scope could not be verified"),
    }));
  });

  it("rejects a changed shell scope even with the same PTY and directory", async () => {
    await render("docker --context prod system prune");
    fixtures.scopeToken = "new-shell-same-pty";
    await act(async () => root.render(<EnvironmentWarningStrip leafId={leaf} />));
    await act(async () => verifyButton()!.click());
    expect(invoke).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Could not stage context check", message: expect.stringContaining("connection changed"),
    }));
  });

  it("does not redirect a warning's staged check when another terminal becomes active", async () => {
    await render("docker --context prod system prune");
    fixtures.target = { ...fixtures.target, ptyId: 2 };
    await act(async () => verifyButton()!.click());
    expect(invoke).not.toHaveBeenCalled();
    expect(fixtures.focus).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not stage context check", variant: "error" }));
  });

  it("does not redirect into a replacement PTY for the same leaf", async () => {
    await render("docker --context prod system prune");
    fixtures.target = { ...fixtures.target, ptyId: 2 };
    fixtures.ptyId = 2;
    await act(async () => verifyButton()!.click());
    expect(invoke).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not stage context check", variant: "error" }));
  });

  it("reports native staging failure without an unhandled rejection or success toast", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("PTY is disconnected"));
    await render("docker --context prod system prune");
    await act(async () => verifyButton()!.click());
    expect(toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: "Could not stage context check", message: "PTY is disconnected", variant: "error",
    }));
    expect(verifyButton()!.disabled).toBe(false);
  });

  it("prevents duplicate writes while staging is in flight", async () => {
    let finish!: () => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await render("docker --context prod system prune");
    await act(async () => { verifyButton()!.click(); verifyButton()!.click(); });
    expect(verifyButton()!.disabled).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(verifyButton()!.disabled).toBe(false);
    expect(toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "Context check staged" }));
  });

  it.each([
    "az --subscription prod vm delete --password private-value",
    "aws --profile prod ec2 stop-instances --token private-value",
    "gcloud --project prod compute instances delete app --headers 'Authorization: Bearer private-value'",
  ])("redacts sensitive command text from both the label and tooltip: %s", async (command) => {
    await render(command);
    expect(container.textContent).toContain("[sensitive command]");
    expect(container.innerHTML).not.toContain("private-value");
    expect(container.querySelector('[title="[sensitive command]"]')).not.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not display another leaf's warning or stage while the leaf changes", async () => {
    await render("docker --context prod system prune", leaf + 1);
    expect(container.textContent).toBe("");
    await act(async () => root.render(<EnvironmentWarningStrip leafId={leaf} />));
    expect(verifyButton()).toBeDefined();
    await act(async () => root.render(<EnvironmentWarningStrip leafId={null} />));
    expect(container.textContent).toBe("");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("shows secondary protected selectors without inventing an inspection action", async () => {
    await render("gcloud --project prod-project --configuration live compute instances delete app");
    expect(container.textContent).toContain("gcloud / prod-project");
    expect(container.textContent).toContain("+1");
    expect(verifyButton()).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });
});
