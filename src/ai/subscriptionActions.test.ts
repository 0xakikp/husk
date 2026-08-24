import { describe, expect, it } from "vitest";
import { parseSubscriptionActionProposals, stripSubscriptionActionProposals } from "./subscriptionActions";

describe("subscription action proposals", () => {
  const root = "/tmp/project";
  it("accepts only explicit, workspace-scoped action fences", () => {
    const result = parseSubscriptionActionProposals("```husk-action\n{\"kind\":\"workspace.read\",\"path\":\"src/main.ts\"}\n```", root);
    expect(result.actions).toEqual([{ kind: "workspace.read", path: "src/main.ts" }]);
    expect(result.rejected).toBe(0);
  });

  it("rejects outside paths and malformed MCP requests", () => {
    const result = parseSubscriptionActionProposals("```husk-action\n[{\"kind\":\"workspace.read\",\"path\":\"../secret\"},{\"kind\":\"mcp.call\",\"serverId\":\"x\",\"toolName\":\"y\",\"input\":[]}]\n```", root);
    expect(result.actions).toHaveLength(0);
    expect(result.rejected).toBe(2);
  });

  it("accepts the exact workspace-root listing shape", () => {
    const result = parseSubscriptionActionProposals(
      "```husk-action\n{\"kind\":\"workspace.list\",\"path\":\".\"}\n```",
      root,
    );
    expect(result.actions).toEqual([{ kind: "workspace.list", path: "." }]);
    expect(result.rejected).toBe(0);
  });

  it("accepts a provider-neutral Project Lens inspection", () => {
    const result = parseSubscriptionActionProposals(
      "```husk-action\n{\"kind\":\"workspace.inspect\"}\n```",
      root,
    );
    expect(result.actions).toEqual([{ kind: "workspace.inspect" }]);
    expect(result.rejected).toBe(0);
  });

  it("rejects and strips a duplicated kind field instead of exposing protocol text", () => {
    const response = "```HUSK-ACTION\n{\"kind\":\"workspace.list\",\"path\":\".\",\"kind\":\"directory\"}\n```";
    const result = parseSubscriptionActionProposals(response, root);
    expect(result.actions).toHaveLength(0);
    expect(result.rejected).toBe(1);
    expect(stripSubscriptionActionProposals(response)).toBe("");
  });

  it("does not treat normal prose as an action", () => {
    expect(parseSubscriptionActionProposals('{"kind":"workspace.read","path":"src/main.ts"}', root).actions).toHaveLength(0);
  });

  it("removes bridge protocol from visible replies", () => {
    expect(stripSubscriptionActionProposals("I will inspect it.\n```husk-action\n{}\n```\nThen I will report back.")).toBe("I will inspect it.\n\nThen I will report back.");
  });
});
