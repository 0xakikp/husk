import { readTimelineCommand, readTimelineMetadata, safeTimelineCommand } from "./commandMetadata";
import type { TimelineEvent } from "./store";

/** Details deliberately use an allowlist: never dump arbitrary metadata, AI
 * prompts, output, or future private fields into the UI or clipboard. */
export function timelinePresentation(event: TimelineEvent) {
  const metadata = readTimelineMetadata(event);
  const isCommand = event.event_type === "command" || event.event_type === "command_failed";
  const hidden = event.sensitivity !== 0 || Boolean(metadata.redacted || metadata.sensitive)
    || safeTimelineCommand(event.summary).sensitive;
  const summary = hidden ? "Sensitive event · details withheld" : displayText(event.summary);
  const command = hidden ? null : readTimelineCommand(event);
  const fields: { label: string; value: string }[] = [];
  const text = (value: unknown) => typeof value === "string" && value.length <= 2_000 ? displayText(value) : "";
  const path = hidden ? "" : text(metadata.path);
  const cwd = hidden ? "" : text(metadata.cwd);
  const exit = metadata.exitCode;
  const duration = metadata.durationMs;
  if (isCommand) {
    fields.push({ label: "Outcome", value: typeof exit === "number" && Number.isSafeInteger(exit)
      ? `Exit ${exit}${exit === 0 ? " · completed" : " · failed"}`
      : event.event_type === "command_failed" ? "Failed · exit code unavailable" : "Finished · exit code unavailable" });
    if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0 && duration < 86_400_000) {
      fields.push({ label: "Duration", value: duration < 1_000 ? `${Math.round(duration)} ms` : `${(duration / 1_000).toFixed(1)} s` });
    }
    if (cwd) fields.push({ label: "Folder", value: cwd });
  }
  if (event.event_type === "file" && path) fields.push({ label: "File", value: path });
  if (event.event_type === "ai" && !hidden) {
    if (metadata.mode === "subscription" || metadata.mode === "api") fields.push({ label: "Connection", value: metadata.mode === "api" ? "API" : "Subscription" });
    if (typeof metadata.contextItems === "number" && Number.isSafeInteger(metadata.contextItems) && metadata.contextItems >= 0) fields.push({ label: "Context", value: `${metadata.contextItems} items` });
    if (typeof metadata.contextBytes === "number" && Number.isSafeInteger(metadata.contextBytes) && metadata.contextBytes >= 0) fields.push({ label: "Size", value: `${(metadata.contextBytes / 1_024).toFixed(1)} KiB` });
  }
  const copy = hidden ? null : command
    ? { label: command.exact ? "Copy command" : "Copy recorded command", value: command.command }
    : isCommand ? null
    : event.event_type === "file" && path && path === metadata.path ? { label: "Copy path", value: path }
    : { label: "Copy summary", value: summary };
  const note = hidden ? "Command text is withheld for privacy."
    : isCommand && !command ? metadata.truncated === true
      ? "This command was too long to retain in full. Copy and workflow capture are unavailable."
      : "Only a summary is available; it cannot be safely reused as a command."
    : command && !command.exact ? "Older record: original command spacing was not preserved. Review before reuse."
    : event.event_type === "ai" ? "Request metadata only. Prompts and replies are not stored in Timeline."
    : event.event_type === "file" ? "Save event only. File contents and diffs are not stored here."
    : isCommand ? "Recorded command only; output is in the terminal. Nothing runs when you copy."
    : "Recorded summary only.";
  return { summary, command, fields, copy, note };
}

function displayText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "�");
}

export function timelineDayLabel(ts: number, now = new Date()): string {
  const date = new Date(ts * 1_000);
  const dayKey = (value: Date) => `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
  if (dayKey(date) === dayKey(now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1); // Calendar days, including DST.
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
