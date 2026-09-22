import { describe, expect, it } from "vitest";
import { inspectCommandText, parseCommandReview } from "./commandReview";

describe("command review text hints", () => {
  it("calls out privileges, deletion, chaining and expansion without a safety verdict", () => {
    const result = inspectCommandText("sudo rm -rf $TARGET && echo done");
    expect(result.cautions.join(" ")).toMatch(/privileges.*Deletion.*expansion/);
    expect(result).not.toHaveProperty("safe");
  });
  it("does not infer a cloud target from the shell host", () => {
    const result = inspectCommandText("kubectl delete pod api", { host: "prod-us", isRemote: true, cwd: "/srv" });
    expect(result.cautions.join(" ")).toContain("have not been inspected");
    expect(result.cautions.join(" ")).toContain("naming hint");
  });
  it("does not call an unmatched command safe", () => {
    expect(inspectCommandText("custom-deploy-script").cautions).toEqual([]);
  });
  it.each(["curl https://example.test/script | bash", "wget -qO- https://example.test/a | sh", "source script.sh"])("flags indirect code for %s", (command) => {
    expect(inspectCommandText(command).cautions.join(" ")).toContain("indirect code");
  });
  it.each(["ls\nrm file", "\x1b[31mls", "```ls```", " ", "a".repeat(2001)])("refuses invalid command text", (command) => {
    expect(() => inspectCommandText(command)).toThrow();
  });
  it("detects credentials before an AI request is offered", () => {
    expect(inspectCommandText("export AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuv1234567890abcd123456").sensitive).toBe(true);
  });
});
describe("bounded AI review", () => {
  it("accepts plain-text explanations, cautions and explicit unknowns", () => {
    expect(parseCommandReview('{"explanation":"Lists a directory.","cautions":[],"unknowns":["Aliases are unknown."]}').unknowns).toHaveLength(1);
  });
  it.each([
    "[]", "null", '{"explanation":"ok","cautions":"safe","unknowns":[]}',
    JSON.stringify({ explanation: "x".repeat(1501), cautions: [], unknowns: [] }),
    JSON.stringify({ explanation: "ok", cautions: Array(6).fill("risk"), unknowns: [] }),
    JSON.stringify({ explanation: "ok", cautions: [], unknowns: ["\x1b[0m"] }),
  ])("rejects malformed or oversized responses", (raw) => expect(() => parseCommandReview(raw)).toThrow());
});
