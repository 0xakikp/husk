import { describe, expect, it } from "vitest";
import { assessTerminalPilotCommand, parseTerminalPilotDecision } from "./terminalPilot";

describe("Terminal Pilot protocol", () => {
  it("rejects oversized commands instead of executing a truncated command", () => {
    expect(parseTerminalPilotDecision(`\`\`\`husk-pilot\n${JSON.stringify({ action: "run", command: "cat " + "x".repeat(600), reason: "inspect" })}\n\`\`\``)).toBeNull();
  });
  it("accepts only an explicit husk-pilot decision block", () => {
    expect(parseTerminalPilotDecision("```husk-pilot\n{\"action\":\"run\",\"command\":\"kubectl get pods\",\"reason\":\"inspect pods\"}\n```"))
      .toEqual({ action: "run", command: "kubectl get pods", reason: "inspect pods" });
    expect(parseTerminalPilotDecision('{"action":"run","command":"pwd","reason":"no fence"}')).toBeNull();
  });

  it("auto-runs only narrow diagnostic commands", () => {
    expect(assessTerminalPilotCommand("kubectl describe pod api-7f")).toMatchObject({ kind: "review" });
    expect(assessTerminalPilotCommand("git status --short")).toEqual({ kind: "safe" });
    expect(assessTerminalPilotCommand("kubectl apply -f deploy.yaml")).toMatchObject({ kind: "review" });
    expect(assessTerminalPilotCommand("rg TODO && rm -rf tmp")).toMatchObject({ kind: "review" });
    expect(assessTerminalPilotCommand("sed -i '' 's/old/new/' src/app.ts")).toMatchObject({ kind: "review" });
    expect(assessTerminalPilotCommand("kubectl logs -f api-7f")).toMatchObject({ kind: "review" });
    expect(assessTerminalPilotCommand("kubectl get pods", ["kubernetes/production"])).toMatchObject({ kind: "review" });
  });

  it.each([
    "git branch -D release", "git branch new-branch", "git diff --output=/tmp/file",
    "pwd & touch /tmp/file", "sed -n e README.md", "sed -n 'w /tmp/file' README.md",
    "find . -fprint /tmp/file", "git log --ext-diff", "tail -f app.log",
    "pwd\r touch file", "pwd\u001b[2J", "cat $(id)", "ls /tmp/*",
    "node --version app.js", "ls 'unterminated", "git status --porcelain; id",
  ])("requires review for %s", (command) => {
    expect(assessTerminalPilotCommand(command)).toMatchObject({ kind: "review" });
  });

  it.each(["pwd", "ls -la", "cat -- 'path with spaces/file.txt'", "head -n 40 README.md", "git branch --show-current"])("allows literal diagnostics: %s", (command) => {
    expect(assessTerminalPilotCommand(command)).toEqual({ kind: "safe" });
  });
});
