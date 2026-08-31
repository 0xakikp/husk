import type { CommandRun } from "../ai/terminalContext";

function readableTitle(value: string, fallback: string): string {
  const first = value.split("\n").map((line) => line.trim()).find(Boolean) || fallback;
  const compact = first.replace(/\s+/g, " ");
  return compact.length > 46 ? `${compact.slice(0, 45).trimEnd()}…` : compact;
}

function fenced(value: string, language: string): string {
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${value.trim()}\n${fence}`;
}

export function formatTerminalSelection(selection: string): { title: string; content: string } {
  const text = selection.trim();
  return {
    title: `Terminal · ${readableTitle(text, "selection")}`,
    content: `## Terminal selection\n\n${fenced(text, "text")}`,
  };
}

export function formatTerminalRun(run: CommandRun): { title: string; content: string } {
  const command = run.command.trim() || "terminal command";
  const output = run.output.trim();
  const status = run.exitCode == null ? "unknown" : String(run.exitCode);
  return {
    title: `Command · ${readableTitle(command, "terminal run")}`,
    content: [
      "## Command",
      "",
      fenced(command, "sh"),
      "",
      `Exit code: ${status}`,
      "",
      "## Output",
      "",
      output ? fenced(output, "text") : "_No output was captured._",
    ].join("\n"),
  };
}
