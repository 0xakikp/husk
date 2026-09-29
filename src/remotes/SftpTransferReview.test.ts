// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SftpTransferReview, type SftpTransferDraft } from "./SftpTransferReview";

let root: Root; let container: HTMLDivElement;
const onConfirm = vi.fn(); const onCancel = vi.fn();
const upload: SftpTransferDraft = { direction: "upload", kind: "file", localPath: "/local/report.txt", remotePath: "/srv/report.txt", label: "report.txt" };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); onConfirm.mockReset(); onCancel.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(drafts: SftpTransferDraft[] = [upload]) {
  await act(async () => root.render(createElement(SftpTransferReview, { target: "engineer@prod.example:2200", drafts, onConfirm, onCancel })));
}
function button(label: string) {
  const item = [...document.querySelectorAll("button")].find(node => node.textContent?.trim() === label);
  expect(item, label).toBeDefined(); return item!;
}
async function click(label: string) { await act(async () => button(label).click()); }

it("shows the exact target and destination and never approves on mount", async () => {
  await render();
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.getAttribute("aria-label")).toBe("Review SFTP transfer");
  expect(dialog?.textContent).toContain("Remote: engineer@prod.example:2200");
  expect(dialog?.textContent).toContain("From: /local/report.txt");
  expect(dialog?.textContent).toContain("To: /srv/report.txt");
  expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  expect(onConfirm).not.toHaveBeenCalled(); expect(onCancel).not.toHaveBeenCalled();
});

it("approves a transfer without overwrite permission by default", async () => {
  await render(); await click("Upload"); expect(onConfirm).toHaveBeenCalledExactlyOnceWith(false);
});

it("requires explicit opt-in for replacements and displays the resulting risk", async () => {
  await render();
  await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(document.body.textContent).toContain("permanently replaced");
  expect(button("Confirm transfer & replacements").dataset.compactVariant).toBe("danger");
  expect(onConfirm).not.toHaveBeenCalled();
  await click("Confirm transfer & replacements"); expect(onConfirm).toHaveBeenCalledExactlyOnceWith(true);
});

it("lets users revoke overwrite permission before confirming", async () => {
  await render();
  const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => checkbox.click()); await act(async () => checkbox.click());
  expect(document.body.textContent).toContain("Existing files are protected");
  await click("Upload"); expect(onConfirm).toHaveBeenCalledExactlyOnceWith(false);
});

it("cancel never starts or approves a transfer", async () => {
  await render(); await click("Cancel"); expect(onCancel).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled();
});

it("shows folder downloads as remote source to selected local parent plus folder name", async () => {
  await render([{ direction: "download", kind: "folder", remotePath: "/srv/logs", localPath: "/local/review", label: "logs" }]);
  expect(document.body.textContent).toContain("From: /srv/logs");
  expect(document.body.textContent).toContain("To: /local/review / logs");
  expect(document.body.textContent).toContain("folder and contents");
  expect(document.body.textContent).toContain("stopped folder transfer can leave files already copied");
  await click("Download"); expect(onConfirm).toHaveBeenCalledExactlyOnceWith(false);
});

it("focuses Cancel initially and Escape cancels without approving", async () => {
  await render();
  expect(document.activeElement).toBe(button("Cancel"));
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(onCancel).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled();
});
