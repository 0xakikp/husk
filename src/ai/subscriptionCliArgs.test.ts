import { describe, expect, it } from "vitest";

import { buildClaudeCliArgs } from "./claudeCli";
import { buildCodexCliArgs } from "./codexCli";

function valuesAfter(args: string[], flag: string): string[] {
  return args.flatMap((value, index) => value === flag ? [args[index + 1]] : []);
}

describe("subscription CLI isolation", () => {
  it("starts Codex without local, connected, web, or subagent tools", () => {
    const args = buildCodexCliArgs("hello", "gpt-5.4-mini");
    const disabled = valuesAfter(args, "--disable");
    const config = valuesAfter(args, "--config");

    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    expect(args).toContain("--strict-config");
    expect(args).toContain("--ephemeral");
    expect(disabled).toEqual(expect.arrayContaining([
      "shell_tool",
      "unified_exec",
      "apps",
      "remote_plugin",
      "multi_agent",
      "goals",
    ]));
    expect(config).toEqual(expect.arrayContaining([
      "agents.enabled=false",
      "apps._default.enabled=false",
      'web_search="disabled"',
    ]));
    expect(args[args.length - 1]).toContain("No Codex tools are available");
  });

  it("starts Claude with an empty tool and MCP surface", () => {
    const args = buildClaudeCliArgs("hello", "sonnet");

    expect(valuesAfter(args, "--tools")).toEqual([""]);
    expect(valuesAfter(args, "--setting-sources")).toEqual([""]);
    expect(valuesAfter(args, "--mcp-config")).toEqual(['{"mcpServers":{}}']);
    expect(args).toEqual(expect.arrayContaining([
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-chrome",
      "--no-session-persistence",
    ]));
    expect(args).not.toContain("--resume");
    expect(args).not.toContain("--disallowed-tools");
  });
});
