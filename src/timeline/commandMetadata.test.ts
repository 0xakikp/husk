import { describe, expect, it } from "vitest";

import { readTimelineCommand, readTimelineMetadata, safeTimelineCommand } from "./commandMetadata";
import type { TimelineEvent } from "./store";

describe("safeTimelineCommand", () => {
  it("keeps ordinary commands in structured metadata", () => {
    expect(safeTimelineCommand("  pnpm   test  ")).toEqual({
      display: "pnpm test",
      command: "  pnpm   test  ",
      sensitive: false,
    });
  });

  it("drops the entire command when credentials may be present", () => {
    expect(safeTimelineCommand("curl --token abc123 example.com")).toEqual({
      display: "[sensitive command]",
      sensitive: true,
    });
    expect(safeTimelineCommand("curl https://me:supersecret@example.com").command).toBeUndefined();
    expect(safeTimelineCommand("export API_KEY=short").command).toBeUndefined();
    expect(safeTimelineCommand("PGPASSWORD=tiny psql app").command).toBeUndefined();
  });

  it("scans beyond the display limit and across its boundary before retaining a summary", () => {
    expect(safeTimelineCommand(`echo ${"x".repeat(600)} --token hidden`)).toEqual({ display: "[sensitive command]", sensitive: true });
    expect(safeTimelineCommand(`echo ${"x".repeat(465)} https://me:password@host`)).toEqual({ display: "[sensitive command]", sensitive: true });
  });

  it("does not offer partial, multiline, or control-character commands for reuse", () => {
    expect(safeTimelineCommand("x".repeat(481))).toMatchObject({ truncated: true, sensitive: false });
    expect(safeTimelineCommand("x".repeat(481)).command).toBeUndefined();
    for (const raw of ["pwd\nrm file", "printf '\t'", "pwd\u001b[2J", "echo \u202eevil"]) {
      expect(safeTimelineCommand(raw).command).toBeUndefined();
    }
  });

  it("preserves quoted and escaped trailing spaces exactly", () => {
    const raw = 'printf "%s" "a   b"\\ ';
    expect(safeTimelineCommand(raw).command).toBe(raw);
  });
});

const event = (metadata: unknown, patch: Partial<TimelineEvent> = {}): TimelineEvent => ({ id: 1, ts: 1, event_type: "command", workspace_id: "/test", summary: "Ran pwd", sensitivity: 0, metadata_json: JSON.stringify(metadata), ...patch });
describe("reading command metadata", () => {
  it("distinguishes exact new commands from older recorded text", () => {
    expect(readTimelineCommand(event({ command: 'echo "a   b"', commandFormat: "exact-v1" }))).toEqual({ command: 'echo "a   b"', exact: true });
    expect(readTimelineCommand(event({ command: "pwd" }))).toEqual({ command: "pwd", exact: false });
  });
  it("fails closed for sensitive, truncated, malformed, unsupported and legacy boundary records", () => {
    for (const metadata of [{ command: "pwd", redacted: true }, { command: "pwd", truncated: true }, { command: "pwd", unsupported: true }, { command: "curl --token value" }, { command: "x".repeat(480) }, null, [], { command: "pwd\nwhoami" }]) {
      expect(readTimelineCommand(event(metadata))).toBeNull();
    }
    expect(readTimelineCommand(event({ command: "pwd" }, { sensitivity: 1 }))).toBeNull();
    expect(readTimelineCommand(event({ command: "pwd" }, { event_type: "ai" }))).toBeNull();
    expect(readTimelineCommand(event({}, { metadata_json: '{"command":' }))).toBeNull();
    expect(readTimelineCommand(event({}))).toBeNull();
  });
  it("bounds and validates metadata without treating arrays or primitives as records", () => {
    for (const raw of ["null", "[]", '"text"', "broken", " ".repeat(16_001)]) expect(readTimelineMetadata({ metadata_json: raw })).toEqual({});
  });
});
