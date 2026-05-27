import { readFile } from "@/fs";
import { getEditorSelection } from "./editorStore";

export interface EditorContext {
  activeFile: {
    path: string;
    name: string;
    content: string;
    language: string;
  } | null;
  openFiles: string[];
  selectedText: {
    text: string;
    startLine: number;
    endLine: number;
  } | null;
}

export async function buildEditorContext(
  activePath: string | null,
  openFiles: string[]
): Promise<EditorContext> {
  if (!activePath) {
    return { activeFile: null, openFiles, selectedText: null };
  }

  const content = await readFile(activePath).catch(() => "// could not read file");
  const name = activePath.split("/").pop() || activePath;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  const langMap: Record<string, string> = {
    ts: "typescript", tsx: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript",
    json: "json", css: "css", scss: "scss", less: "less",
    html: "html", md: "markdown", py: "python", rs: "rust",
    go: "go", java: "java", c: "c", h: "c", cpp: "cpp", hpp: "cpp",
    sh: "shell", bash: "shell", zsh: "shell",
    yml: "yaml", yaml: "yaml", toml: "ini", sql: "sql", xml: "xml",
  };

  return {
    activeFile: {
      path: activePath,
      name,
      content,
      language: langMap[ext] ?? "plaintext",
    },
    openFiles,
    selectedText: getEditorSelection(),
  };
}

export function formatContextForPrompt(ctx: EditorContext): string {
  const lines: string[] = [];

  if (ctx.openFiles.length > 0) {
    lines.push(`Open files: ${ctx.openFiles.map((p) => p.split("/").pop() || p).join(", ")}`);
  }

  if (ctx.selectedText) {
    lines.push(`\n--- Selected text (lines ${ctx.selectedText.startLine}-${ctx.selectedText.endLine}) ---`);
    lines.push(ctx.selectedText.text);
    lines.push("--- end of selection ---\n");
  }

  if (ctx.activeFile) {
    lines.push(`\n--- Active file: ${ctx.activeFile.name} (${ctx.activeFile.language}) ---`);
    lines.push(ctx.activeFile.content);
    lines.push("--- end of file ---\n");
  }

  return lines.join("\n");
}
