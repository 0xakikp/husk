import { describe, expect, it } from "vitest";
import { assessTerminalPilotCommand, parseTerminalPilotDecision } from "./terminalPilot";

describe("Terminal Pilot protocol", () => {
  it("accepts only an explicit husk-pilot decision block", () => {
    expect(parseTerminalPilotDecision("```husk-pilot\n{\"action\":\"run\",\"command\":\"kubectl get pods\",\"reason\":\"inspect pods\"}\n```"))
      .toEqual({ action: "run", command: "kubectl get pods", reason: "inspect pods" });
    expect(parseTerminalPilotDecision('{"action":"run","command":"pwd","reason":"no fence"}')).toBeNull();
  });

  it("auto-runs only narrow diagnostic commands", () => {
    expect(assessTerminalPilotCommand("kubectl describe pod api-7f")).toEqual({ kind: "safe" });
    expect(assessTerminalPilotCommand("git status --short")).toEqual({ kind: "safe" });
    expect(assessTerminalPilotCommand("kubectl apply -f deploy.yaml")).toMatchObject({ kind: "review" });
    expect(assessTerminalPilotCommand("rg TODO && rm -rf tmp")).toMatchObject({ kind: "review" });
    expect(assessTerminalPilotCommand("sed -i '' 's/old/new/' src/app.ts")).toMatchObject({ kind: "review" });
    expect(assessTerminalPilotCommand("kubectl logs -f api-7f")).toMatchObject({ kind: "review" });
    expect(assessTerminalPilotCommand("kubectl get pods", ["kubernetes/production"])).toMatchObject({ kind: "review" });
  });
});
