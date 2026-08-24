import { describe, expect, it } from "vitest";

import type { TimelineEvent } from "../timeline/store";
import {
  detectWorkflowSuggestion,
  isSafeWorkflowSuggestionCommand,
  timelineCommand,
} from "./suggestions";

function event(
  id: number,
  ts: number,
  command: string,
  terminalSessionId: string,
  failed = false,
): TimelineEvent {
  return {
    id,
    ts,
    workspace_id: "/repo",
    event_type: failed ? "command_failed" : "command",
    summary: failed ? `${command} failed` : `Ran ${command}`,
    metadata_json: JSON.stringify({ command, cwd: "/repo", terminalSessionId, exitCode: failed ? 1 : 0 }),
    sensitivity: 0,
  };
}

describe("workflow suggestion detection", () => {
  it("offers the longest exact safe routine repeated across terminal sessions", () => {
    const chronological = [
      event(1, 10, "pnpm lint", "one"),
      event(2, 11, "pnpm test", "one"),
      event(3, 20, "pnpm lint", "two"),
      event(4, 21, "pnpm test", "two"),
      event(5, 30, "pnpm lint", "three"),
      event(6, 31, "pnpm test", "three"),
    ];
    const result = detectWorkflowSuggestion([...chronological].reverse(), "/repo");
    expect(result?.steps).toEqual(["pnpm lint", "pnpm test"]);
    expect(result?.occurrences).toBe(3);
    expect(result?.sessionCount).toBe(3);
  });

  it("does not learn one terminal session, failures, or risky commands", () => {
    const oneSession = [
      event(1, 10, "pnpm lint", "one"), event(2, 11, "pnpm test", "one"),
      event(3, 20, "pnpm lint", "one"), event(4, 21, "pnpm test", "one"),
      event(5, 30, "pnpm lint", "one"), event(6, 31, "pnpm test", "one"),
    ];
    expect(detectWorkflowSuggestion([...oneSession].reverse(), "/repo")).toBeNull();

    const withFailure = oneSession.map((row, index) => index === 5 ? event(6, 31, "pnpm test", "three", true) : { ...row, metadata_json: row.metadata_json.replace('"one"', `"s${Math.floor(index / 2)}"`) });
    expect(detectWorkflowSuggestion([...withFailure].reverse(), "/repo")).toBeNull();
    expect(isSafeWorkflowSuggestionCommand("terraform destroy -auto-approve")).toBe(false);
    expect(isSafeWorkflowSuggestionCommand("curl -H 'Authorization: Bearer abcdefghijk' example.com")).toBe(false);
  });

  it("uses only structured non-redacted Timeline commands", () => {
    expect(timelineCommand({ ...event(1, 10, "pnpm test", "one"), metadata_json: "{}" })).toBeNull();
    expect(timelineCommand({ ...event(1, 10, "pnpm test", "one"), metadata_json: JSON.stringify({ redacted: true }) })).toBeNull();
  });

  it("scopes ignored-routine identity to the workspace", () => {
    const chronological = [
      event(1, 10, "pnpm lint", "one"), event(2, 11, "pnpm test", "one"),
      event(3, 20, "pnpm lint", "two"), event(4, 21, "pnpm test", "two"),
      event(5, 30, "pnpm lint", "three"), event(6, 31, "pnpm test", "three"),
    ];
    const first = detectWorkflowSuggestion([...chronological].reverse(), "/repo-a");
    const second = detectWorkflowSuggestion([...chronological].reverse(), "/repo-b");
    expect(first?.steps).toEqual(second?.steps);
    expect(first?.fingerprint).not.toBe(second?.fingerprint);
  });
});
