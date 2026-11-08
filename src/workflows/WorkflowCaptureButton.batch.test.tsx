// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./savedCommandCapture", () => ({ captureSavedCommand: vi.fn() }));
import { captureSavedCommand } from "./savedCommandCapture";
import { WorkflowCaptureButton } from "./WorkflowCaptureButton";
import { clearWorkflowCaptureRequest, getWorkflowCaptureRequest } from "./captureRequest";

let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearWorkflowCaptureRequest(); vi.mocked(captureSavedCommand).mockClear();
  document.getSelection()?.removeAllRanges();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); clearWorkflowCaptureRequest(); document.getSelection()?.removeAllRanges();
});
const render = async (props: ComponentProps<typeof WorkflowCaptureButton>) => {
  await act(async () => root.render(<div className="composer-code-block"><div className="composer-code-actions"><WorkflowCaptureButton {...props} /></div><pre className="composer-code-pre"><code>{props.code}</code></pre></div>));
};
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
  expect(found, label).toBeDefined(); return found!;
}
async function click(label: string) { await act(async () => button(label).click()); }
function highlight(code: Element, start: number, end: number) {
  const text = code.firstChild!;
  const range = document.createRange(); range.setStart(text, start); range.setEnd(text, end);
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
}

it("keeps an unchanged single-line command in the exact-text legacy capture", async () => {
  const code = "  printf first  ";
  await render({ language: "sh", code }); await click("Add to workflow…");
  expect(getWorkflowCaptureRequest()).toMatchObject({ text: code, source: "ai-code" });
  expect(getWorkflowCaptureRequest()?.steps).toBeUndefined();
  expect(captureSavedCommand).not.toHaveBeenCalled();
});

it("offers each simple command within one block, without preselecting a sequence", async () => {
  await render({ language: "sh", code: "  printf first\nprintf second  " }); await click("Choose commands…");
  expect(getWorkflowCaptureRequest()).toMatchObject({ steps: ["  printf first", "printf second  "], selectedIndices: [] });
  expect(getWorkflowCaptureRequest()?.stepTitles).toBeUndefined();
});

it("offers all eight distribution alternatives independently, with no alternatives selected", async () => {
  const downloads = "# Debian/Ubuntu — download without installing\napt download <package>\n\n# Fedora/RHEL\ndnf download <package>\n\n# Arch Linux\npacman -Sw <package>\n\n# Alpine\napk fetch <package>";
  const installs = "sudo apt install <package>\nsudo dnf install <package>\nsudo pacman -S <package>\nsudo apk add <package>";
  const blocks = [{ lang: "sh", code: downloads }, { lang: "sh", code: installs }];
  await render({ language: "sh", code: downloads, blocks, blockIndex: 0 }); await click("Choose commands…");
  expect(getWorkflowCaptureRequest()).toMatchObject({
    steps: ["apt download <package>", "dnf download <package>", "pacman -Sw <package>", "apk fetch <package>", "sudo apt install <package>", "sudo dnf install <package>", "sudo pacman -S <package>", "sudo apk add <package>"],
    selectedIndices: [],
    stepTitles: ["Debian/Ubuntu — download without installing", "Fedora/RHEL", "Arch Linux", "Alpine", "", "", "", ""],
    candidateDetails: [
      { label: "Debian/Ubuntu — download without installing", blockIndex: 0, lineStart: 2, lineEnd: 2, kind: "command" },
      { label: "Fedora/RHEL", blockIndex: 0, lineStart: 5, lineEnd: 5, kind: "command" },
      { label: "Arch Linux", blockIndex: 0, lineStart: 8, lineEnd: 8, kind: "command" },
      { label: "Alpine", blockIndex: 0, lineStart: 11, lineEnd: 11, kind: "command" },
      { label: "", blockIndex: 1, lineStart: 1, lineEnd: 1, kind: "command" },
      { label: "", blockIndex: 1, lineStart: 2, lineEnd: 2, kind: "command" },
      { label: "", blockIndex: 1, lineStart: 3, lineEnd: 3, kind: "command" },
      { label: "", blockIndex: 1, lineStart: 4, lineEnd: 4, kind: "command" },
    ],
  });
});

it("offers only explicitly shell-labelled candidates in response order, all initially unselected", async () => {
  const blocks = [{ lang: "python", code: "print('example')" }, { lang: "sh", code: "pnpm lint" }, { lang: "", code: "unknown code" }, { lang: "bash", code: "pnpm test" }, { lang: "json", code: "{}" }, { lang: "zsh", code: "pwd" }];
  await render({ language: "bash", code: "pnpm test", blocks, blockIndex: 3 });
  expect(getWorkflowCaptureRequest()).toBeNull(); await click("Choose commands…");
  expect(getWorkflowCaptureRequest()).toMatchObject({ source: "ai-code", steps: ["pnpm lint", "pnpm test", "pwd"], selectedIndices: [] });
  expect(getWorkflowCaptureRequest()?.candidateDetails?.map(({ blockIndex }) => blockIndex)).toEqual([1, 3, 5]);
  expect(captureSavedCommand).not.toHaveBeenCalled();
});

it("preserves repeated commands as distinct indexed candidates rather than deduplicating", async () => {
  const blocks = [{ lang: "sh", code: "pwd\npwd" }, { lang: "sh", code: "cd src" }, { lang: "sh", code: "pwd" }];
  await render({ language: "sh", code: "pwd", blocks, blockIndex: 2 }); await click("Choose commands…");
  expect(getWorkflowCaptureRequest()).toMatchObject({ steps: ["pwd", "pwd", "cd src", "pwd"], selectedIndices: [] });
  expect(getWorkflowCaptureRequest()?.candidateDetails?.map(({ blockIndex, lineStart }) => [blockIndex, lineStart])).toEqual([[0, 1], [0, 2], [1, 1], [2, 1]]);
});

it.each(["cat <<'END'\nfirst\nsecond\nEND", "if test -f package.json; then\n  pnpm test\nfi", "printf '%s\\n' \\\n  'first' 'second'"])("keeps a script intact and explicitly unselected: %s", async (code) => {
  await render({ language: "sh", code }); await click("Choose commands…");
  expect(getWorkflowCaptureRequest()).toMatchObject({ steps: [code], selectedIndices: [], candidateDetails: [{ kind: "script" }] });
});

it("uses a short comment as a title, but does not save oversized labels as titles", async () => {
  const longLabel = "界".repeat(60);
  const code = `# Short title\npwd\n# ${longLabel}\ndate`;
  await render({ language: "sh", code }); await click("Choose commands…");
  expect(getWorkflowCaptureRequest()?.stepTitles).toEqual(["Short title", ""]);
  expect(getWorkflowCaptureRequest()?.candidateDetails?.[1].label).toBe(longLabel);
});

it("still saves only the active command when other candidate commands are present", async () => {
  const blocks = [{ lang: "sh", code: "pnpm lint" }, { lang: "sh", code: "pnpm test" }];
  await render({ language: "sh", code: "pnpm test", blocks, blockIndex: 1 }); await click("Save command…");
  expect(captureSavedCommand).toHaveBeenCalledExactlyOnceWith("pnpm test", "ai-code"); expect(getWorkflowCaptureRequest()).toBeNull();
});

it("does not offer workflow or saved-command actions for an active non-shell fence", async () => {
  for (const language of ["", "python", "json", "powershell", "husk-workflow"]) {
    await render({ language, code: "data", blocks: [{ lang: "sh", code: "pwd" }, { lang: "bash", code: "date" }, { lang: language, code: "data" }], blockIndex: 2 });
    expect(container.querySelector("button")).toBeNull();
  }
  expect(getWorkflowCaptureRequest()).toBeNull(); expect(captureSavedCommand).not.toHaveBeenCalled();
});

it("keeps the single-command action when only one explicitly shell-labelled candidate exists", async () => {
  await render({ language: "sh", code: "pwd", blocks: [{ lang: "json", code: "{}" }, { lang: "sh", code: "pwd" }], blockIndex: 1 });
  await click("Add to workflow…"); expect(getWorkflowCaptureRequest()?.steps).toBeUndefined();
});

it("does not silently substitute other commands when the active index no longer matches", async () => {
  await render({ language: "sh", code: "pwd", blocks: [{ lang: "sh", code: "pwd" }, { lang: "sh", code: "date" }], blockIndex: 1 });
  await click("Add to workflow…"); expect(getWorkflowCaptureRequest()).toMatchObject({ text: "pwd" }); expect(getWorkflowCaptureRequest()?.steps).toBeUndefined();
});

it("supports a caller without an explicit index when the active candidate matches", async () => {
  await render({ language: "sh", code: "pwd", blocks: [{ lang: "sh", code: "date" }, { lang: "sh", code: "pwd" }] });
  await click("Choose commands…"); expect(getWorkflowCaptureRequest()).toMatchObject({ steps: ["date", "pwd"], selectedIndices: [] });
});

it("captures a live in-block highlight exactly without splitting it or losing it on mouse down", async () => {
  const code = "# alternatives\n  apt download <package>  \ndnf download <package>";
  await render({ language: "sh", code });
  const selected = "  apt download <package>  \ndnf";
  highlight(container.querySelector("code")!, code.indexOf(selected), code.indexOf(selected) + selected.length);
  const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  button("Choose commands…").dispatchEvent(mouseDown); expect(mouseDown.defaultPrevented).toBe(true);
  await click("Choose commands…");
  expect(getWorkflowCaptureRequest()).toMatchObject({ text: selected, source: "ai-code" }); expect(getWorkflowCaptureRequest()?.steps).toBeUndefined();
});

it("saves the exact live selected text from its active code without capturing the whole block", async () => {
  const code = "pwd\n  date  "; await render({ language: "sh", code });
  highlight(container.querySelector("code")!, 4, code.length);
  const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  button("Save command…").dispatchEvent(mouseDown); expect(mouseDown.defaultPrevented).toBe(true);
  await click("Save command…"); expect(captureSavedCommand).toHaveBeenCalledExactlyOnceWith("  date  ", "ai-code"); expect(getWorkflowCaptureRequest()).toBeNull();
});

it("never imports selection from another code block or terminal", async () => {
  await render({ language: "sh", code: "pwd\ndate" });
  const otherBlock = document.createElement("div"); otherBlock.className = "composer-code-block";
  const pre = document.createElement("pre"); pre.className = "composer-code-pre";
  const otherCode = document.createElement("code"); otherCode.textContent = "external command"; pre.append(otherCode); otherBlock.append(pre); container.append(otherBlock);
  highlight(otherCode, 0, otherCode.textContent.length);
  const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  button("Choose commands…").dispatchEvent(mouseDown); expect(mouseDown.defaultPrevented).toBe(false);
  await click("Choose commands…"); expect(getWorkflowCaptureRequest()).toMatchObject({ steps: ["pwd", "date"], selectedIndices: [] });
  await click("Save command…"); expect(captureSavedCommand).toHaveBeenCalledExactlyOnceWith("pwd\ndate", "ai-code");
});

it("rejects a highlight spanning the code and the surrounding reply", async () => {
  await render({ language: "sh", code: "pwd" });
  const outside = document.createElement("p"); outside.textContent = "prose"; container.append(outside);
  const range = document.createRange(); range.setStart(container.querySelector("code")!.firstChild!, 0); range.setEnd(outside.firstChild!, 5); document.getSelection()!.addRange(range);
  await click("Add to workflow…"); expect(getWorkflowCaptureRequest()?.text).toBe("pwd");
});

it("rejects code highlights when the displayed code no longer matches the action", async () => {
  await render({ language: "sh", code: "pwd" });
  const code = container.querySelector("code")!; code.textContent = "date"; highlight(code, 0, 4);
  await click("Add to workflow…"); expect(getWorkflowCaptureRequest()?.text).toBe("pwd");
});

it("never reuses an earlier selection after the user clears it", async () => {
  await render({ language: "sh", code: "pwd\ndate" }); highlight(container.querySelector("code")!, 0, 3);
  const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true }); button("Choose commands…").dispatchEvent(mouseDown);
  document.getSelection()!.removeAllRanges(); await click("Choose commands…");
  expect(getWorkflowCaptureRequest()).toMatchObject({ steps: ["pwd", "date"], selectedIndices: [] });
});

it("does not capture a whitespace-only highlight or prevent normal mouse focus", async () => {
  await render({ language: "sh", code: "pwd  " }); highlight(container.querySelector("code")!, 3, 5);
  const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true }); button("Add to workflow…").dispatchEvent(mouseDown); expect(mouseDown.defaultPrevented).toBe(false);
  await click("Add to workflow…"); expect(getWorkflowCaptureRequest()?.text).toBe("pwd  ");
});
