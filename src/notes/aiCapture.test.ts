import { describe, expect, it } from "vitest";
import { extractCommandMarkdown, inferCaptureTitle, markdownToPlainText } from "./aiCapture";

describe("AI note capture formatting", () => {
  it("uses a Markdown heading as a readable filename title", () => {
    expect(inferCaptureTitle("## Fix port conflicts\n\nUse lsof.", "response")).toBe("Fix port conflicts");
  });

  it("removes filename-unsafe characters from inferred titles", () => {
    expect(inferCaptureTitle("Fix API: port 3000 / local?", "response")).toBe("Fix API port 3000 local");
  });

  it("extracts fenced commands without surrounding prose", () => {
    expect(extractCommandMarkdown("Run this:\n\n```sh\nlsof -i :3000\nkill 42\n```\n\nDone.")).toBe(
      "```sh\nlsof -i :3000\nkill 42\n```",
    );
  });

  it("does not present ordinary source code as shell commands", () => {
    expect(extractCommandMarkdown("```js\nconsole.log('hello')\n```" )).toBe("");
  });

  it("creates readable plain text for clipboard copy", () => {
    expect(markdownToPlainText("# Fix\n\nUse **this** [guide](https://example.com).\n\n```sh\npnpm test\n```")).toBe(
      "Fix\n\nUse this guide.\n\npnpm test",
    );
  });
});
