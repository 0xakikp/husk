import { describe, expect, it } from "vitest";
import { formatTerminalRun, formatTerminalSelection } from "./terminalCapture";

describe("terminal Vault capture formatting", () => {
  it("keeps a selected terminal block readable", () => {
    const capture = formatTerminalSelection("line one\nline two");
    expect(capture.title).toBe("Terminal · line one");
    expect(capture.content).toContain("```text\nline one\nline two\n```");
  });

  it("records the command, output, and exit code", () => {
    const capture = formatTerminalRun({ command: "pnpm test", output: "2 passed", exitCode: 0, at: 1 });
    expect(capture.title).toBe("Command · pnpm test");
    expect(capture.content).toContain("```sh\npnpm test\n```");
    expect(capture.content).toContain("Exit code: 0");
    expect(capture.content).toContain("```text\n2 passed\n```");
  });

  it("uses a longer fence when captured output contains backticks", () => {
    const capture = formatTerminalSelection("```\ninside\n```");
    expect(capture.content).toContain("````text");
  });
});
