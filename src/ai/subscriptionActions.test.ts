import { describe, expect, it } from "vitest";
import { parseSubscriptionActionProposals, stripSubscriptionActionProposals } from "./subscriptionActions";

describe("subscription action proposals", () => {
  const root = "/tmp/project";
  const ticks = String.fromCharCode(96).repeat(3);
  const actionFence = (action: unknown) => [ticks + "husk-action", JSON.stringify(action), ticks].join("\n");
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

  it("accepts a write proposal even when its fence immediately follows prose", () => {
    const response = `I found the right location.\`\`\`husk-action\n${JSON.stringify({
      kind: "workspace.write",
      path: "add.sh",
      content: "#!/usr/bin/env sh\n\nprintf '%s\\n' \"$1\"",
    })}\n\`\`\`\n`;
    const result = parseSubscriptionActionProposals(response, root);
    expect(result.actions).toEqual([{
      kind: "workspace.write",
      path: "add.sh",
      content: "#!/usr/bin/env sh\n\nprintf '%s\\n' \"$1\"",
    }]);
    expect(result.rejected).toBe(0);
    expect(stripSubscriptionActionProposals(response)).toBe("I found the right location.");
  });

  it("rejects and hides an unterminated action block", () => {
    const response = "I will create it.```husk-action\n{\"kind\":\"workspace.write\",\"path\":\"add.sh\",\"content\":\"echo ok\"}";
    const result = parseSubscriptionActionProposals(response, root);
    expect(result.actions).toHaveLength(0);
    expect(result.rejected).toBe(1);
    expect(stripSubscriptionActionProposals(response)).toBe("I will create it.");
  });

  it("never promotes nested action examples from invalid or unfinished workflow proposals", () => {
    const nested = actionFence({ kind: "workspace.write", path: "example.txt", content: "not an instruction" });
    for (const [open, close] of [
      [ticks + "husk-workflow", ticks],
      [ticks + "`husk-workflow", ticks + "`"],
      ["~~~husk-workflow", "~~~"],
      ["  " + ticks + "HUSK-WORKFLOW  ", "  " + ticks],
      [ticks + "`husk-workflow", ""],
      ["~~~husk-workflow", ""],
    ]) {
      const response = [open, "Malformed example:", nested, close].filter(Boolean).join("\n");
      expect(parseSubscriptionActionProposals(response, root)).toEqual({ actions: [], rejected: 0 });
      expect(stripSubscriptionActionProposals(response)).toBe(response.trim());
    }
  });

  it("ignores action markers inside valid workflow JSON without triggering correction", () => {
    const response = [ticks + "husk-workflow", JSON.stringify({ version: 1, name: "Literal protocol example", steps: ["printf '%s' '" + ticks + "husk-action'"] }), ticks].join("\n");
    expect(parseSubscriptionActionProposals(response, root)).toEqual({ actions: [], rejected: 0 });
    expect(stripSubscriptionActionProposals(response)).toBe(response);
  });

  it("parses surrounding real actions while retaining original workflow proposal text", () => {
    const before = { kind: "workspace.list", path: "." };
    const after = { kind: "workspace.read", path: "src/main.ts" };
    const workflow = ["~~~husk-workflow", "Malformed example:", actionFence({ kind: "workspace.write", path: "nested.txt", content: "data" }), "~~~"].join("\n");
    const response = [actionFence(before), workflow, actionFence(after)].join("\n\n");
    expect(parseSubscriptionActionProposals(response, root)).toEqual({ actions: [before, after], rejected: 0 });
    expect(stripSubscriptionActionProposals(response)).toBe(workflow);
  });

  it("does not let inline action fences bypass isolation of following workflow proposals", () => {
    const action = { kind: "workspace.list", path: "." };
    const prefix = "I will inspect." + actionFence(action);
    for (const close of ["", ticks + "`"]) {
      const workflow = [ticks + "`husk-workflow", "Malformed example:", actionFence({ kind: "workspace.write", path: "nested.txt", content: "data" }), close].filter(Boolean).join("\n");
      const response = [prefix, workflow].join("\n\n");
      expect(parseSubscriptionActionProposals(response, root)).toEqual({ actions: [action], rejected: 0 });
      expect(stripSubscriptionActionProposals(response)).toBe("I will inspect.\n\n" + workflow);
    }
  });

  it("never executes workflow action examples inside surrounding Markdown documentation", () => {
    const workflow = [ticks + "`husk-workflow", "Malformed example:", actionFence({ kind: "workspace.write", path: "nested.txt", content: "data" }), ticks + "`"].join("\n");
    const response = [ticks + "``markdown", workflow, ticks + "``"].join("\n");
    expect(parseSubscriptionActionProposals(response, root)).toEqual({ actions: [], rejected: 0 });
    expect(stripSubscriptionActionProposals(response)).toBe(response);
  });

  it("keeps actions inside inline or excessively indented workflow proposals inert", () => {
    const workflow = [ticks + "`husk-workflow", "Malformed example:", actionFence({ kind: "workspace.write", path: "nested.txt", content: "data" }), ticks + "`"].join("\n");
    for (const prefix of ["Example: ", "    ", "\t"]) {
      const response = prefix + workflow;
      expect(parseSubscriptionActionProposals(response, root)).toEqual({ actions: [], rejected: 0 });
      expect(stripSubscriptionActionProposals(response)).toBe(response.trim());
    }
  });

  it("does not mask escaped workflow documentation inside valid action JSON", () => {
    const action = { kind: "workspace.write", path: "guide.md", content: [ticks + "husk-workflow", '{"version":1,"name":"Status","steps":["pwd"]}', ticks].join("\n") };
    expect(parseSubscriptionActionProposals(actionFence(action), root)).toEqual({ actions: [action], rejected: 0 });
  });
});
