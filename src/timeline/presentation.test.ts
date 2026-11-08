import { describe, expect, it } from "vitest";
import { timelineDayLabel, timelinePresentation } from "./presentation";
import type { TimelineEvent } from "./store";

const event = (metadata: unknown = {}, patch: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: 1, ts: 1_700_000_000, workspace_id: "/test", event_type: "command", summary: "Ran pnpm test", metadata_json: JSON.stringify(metadata), sensitivity: 0, ...patch,
});
describe("Timeline presentation", () => {
  it("uses only known metadata and preserves exact command text", () => {
    const command = 'printf "%s" "a   b"';
    const detail = timelinePresentation(event({ command, commandFormat: "exact-v1", exitCode: 0, durationMs: 1234, cwd: "/project", privateField: "secret-value", output: "full output" }));
    expect(detail.copy).toEqual({ label: "Copy command", value: command });
    expect(detail.fields).toEqual([{ label: "Outcome", value: "Exit 0 · completed" }, { label: "Duration", value: "1.2 s" }, { label: "Folder", value: "/project" }]);
    expect(JSON.stringify(detail)).not.toContain("secret-value");
    expect(JSON.stringify(detail)).not.toContain("full output");
  });
  it("never reconstructs an old summary-only command, including failed ones", () => {
    const detail = timelinePresentation(event({}, { event_type: "command_failed", summary: "kubectx failed (exit 127)" }));
    expect(detail.copy).toBeNull();
    expect(detail.note).toContain("Only a summary");
    expect(detail.fields[0].value).toBe("Failed · exit code unavailable");
  });
  it("labels legacy normalized text instead of implying exact fidelity", () => {
    const detail = timelinePresentation(event({ command: "pnpm test" }));
    expect(detail.copy?.label).toBe("Copy recorded command");
    expect(detail.note).toContain("original command spacing was not preserved");
  });
  it("withholds sensitive summaries, commands and folders", () => {
    const detail = timelinePresentation(event({ command: "secret", cwd: "/private" }, { sensitivity: 1, summary: "private summary" }));
    expect(detail.copy).toBeNull();
    expect(JSON.stringify(detail)).not.toContain("private");
    expect(timelinePresentation(event({ command: "pwd" }, { summary: "curl --token secret" })).copy).toBeNull();
  });
  it("offers file paths and metadata-only AI summaries, not hidden raw data", () => {
    expect(timelinePresentation(event({ path: "/project/file.ts" }, { event_type: "file", summary: "Edited file.ts" })).copy).toEqual({ label: "Copy path", value: "/project/file.ts" });
    const ai = timelinePresentation(event({ mode: "api", contextItems: 2, contextBytes: 2048, prompt: "do not expose" }, { event_type: "ai", summary: "Asked Husk AI" }));
    expect(ai.copy).toEqual({ label: "Copy summary", value: "Asked Husk AI" });
    expect(ai.fields).toEqual([{ label: "Connection", value: "API" }, { label: "Context", value: "2 items" }, { label: "Size", value: "2.0 KiB" }]);
    expect(JSON.stringify(ai)).not.toContain("do not expose");
  });
  it("does not copy a path containing hidden control characters", () => {
    expect(timelinePresentation(event({ path: "/project/\u001bfile" }, { event_type: "file" })).copy?.label).not.toBe("Copy path");
  });
  it("uses calendar-relative day labels and distinguishes years", () => {
    const now = new Date(2026, 10, 6, 0, 10);
    expect(timelineDayLabel(new Date(2026, 10, 6, 0, 1).getTime() / 1000, now)).toBe("Today");
    expect(timelineDayLabel(new Date(2026, 10, 5, 23, 59).getTime() / 1000, now)).toBe("Yesterday");
    expect(timelineDayLabel(new Date(2025, 10, 5).getTime() / 1000, now)).toContain("2025");
  });
});
