import { createDir, deletePath, readDir, readFile, writeFile } from "../fs";
import { getEditorDocument, replaceEditorDocument } from "../ai/editorStore";
import { ensureNotesDirectory, isNoteFile, loadNotesTree, type FileNode } from "./store";

const AI_NOTES_FOLDER = "AI Notes";

export type VaultNoteTarget = {
  path: string;
  name: string;
  folder: string;
};

export type AiCaptureMetadata = {
  workspacePath?: string;
  conversationName?: string;
  /** Defaults to Husk AI for backwards-compatible AI response captures. */
  source?: "husk-ai" | "husk-terminal";
  /** Optional explicit title for sources such as terminal captures. */
  title?: string;
  kind: "response" | "selection" | "commands";
};

export type VaultCaptureUndo =
  | { kind: "create"; path: string; expected: string }
  | { kind: "append"; path: string; before: string; expected: string };

export type VaultCaptureResult = {
  path: string;
  name: string;
  undo: VaultCaptureUndo;
};

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/(`{1,2}|\*\*|__|~~)/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractCommandMarkdown(markdown: string): string {
  const blocks: string[] = [];
  const commandLanguages = new Set(["", "bash", "sh", "shell", "zsh", "fish", "powershell", "ps1", "cmd", "console", "terminal"]);
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  for (const match of markdown.matchAll(fence)) {
    const language = match[1].trim();
    if (!commandLanguages.has(language.toLocaleLowerCase())) continue;
    const code = match[2].trim();
    if (!code) continue;
    blocks.push(`\`\`\`${language}\n${code}\n\`\`\``);
  }
  return blocks.join("\n\n");
}

function cleanTitleCandidate(value: string): string {
  return markdownToPlainText(value)
    .replace(/^[\s"'`]+|[\s"'`]+$/g, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "")
    .trim();
}

export function inferCaptureTitle(markdown: string, kind: AiCaptureMetadata["kind"]): string {
  const heading = markdown.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1];
  const proseLine = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("```") && !/^[-*_]{3,}$/.test(line));
  const fallback = kind === "commands" ? "Saved commands" : kind === "selection" ? "AI selection" : "AI note";
  const title = cleanTitleCandidate(heading || proseLine || fallback) || fallback;
  return title.length > 58 ? `${title.slice(0, 57).trimEnd()}…` : title;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function noteContents(content: string, title: string, metadata: AiCaptureMetadata): string {
  const created = new Date().toISOString();
  const fields = [
    "---",
    `source: ${metadata.source ?? "husk-ai"}`,
    `capture: ${metadata.kind}`,
    `created: ${created}`,
    ...(metadata.workspacePath ? [`workspace: ${yamlString(metadata.workspacePath)}`] : []),
    ...(metadata.conversationName ? [`conversation: ${yamlString(metadata.conversationName)}`] : []),
    "---",
  ];
  return `${fields.join("\n")}\n\n# ${title}\n\n${content.trim()}\n`;
}

function appendContents(path: string, content: string, metadata: AiCaptureMetadata): string {
  const title = cleanTitleCandidate(metadata.title || "") || inferCaptureTitle(content, metadata.kind);
  const label = metadata.source === "husk-terminal"
    ? metadata.kind === "commands" ? `Terminal command · ${title}` : `Terminal selection · ${title}`
    : metadata.kind === "commands" ? "Commands saved from Husk" : `Saved from Husk AI · ${title}`;
  if (/\.txt$/i.test(path)) {
    return `\n\n---\n\n${label}\n\n${markdownToPlainText(content)}\n`;
  }
  return `\n\n---\n\n## ${label}\n\n${content.trim()}\n`;
}

async function ensureAiNotesDirectory(): Promise<string> {
  const root = await ensureNotesDirectory();
  const entries = await readDir(root);
  const existing = entries.find((entry) => entry.name.toLocaleLowerCase() === AI_NOTES_FOLDER.toLocaleLowerCase());
  if (existing && !existing.is_dir) {
    throw new Error(`A file named “${AI_NOTES_FOLDER}” already exists in Vault.`);
  }
  if (existing) return `${root}/${existing.name}`;
  const target = `${root}/${AI_NOTES_FOLDER}`;
  await createDir(target);
  return target;
}

async function uniqueNotePath(dir: string, title: string): Promise<{ path: string; name: string }> {
  const entries = await readDir(dir);
  const names = new Set(entries.map((entry) => entry.name.toLocaleLowerCase()));
  const base = cleanTitleCandidate(title) || "AI note";
  let name = `${base}.md`;
  let suffix = 2;
  while (names.has(name.toLocaleLowerCase())) {
    name = `${base} (${suffix++}).md`;
  }
  return { path: `${dir}/${name}`, name };
}

function flattenNotes(nodes: FileNode[], root: string, out: VaultNoteTarget[]): void {
  for (const node of nodes) {
    if (node.isDirectory) {
      flattenNotes(node.children || [], root, out);
      continue;
    }
    if (!isNoteFile(node.name)) continue;
    const parent = node.path.slice(0, node.path.lastIndexOf("/"));
    out.push({
      path: node.path,
      name: node.name,
      folder: parent === root ? "Vault" : parent.startsWith(`${root}/`) ? parent.slice(root.length + 1) : parent,
    });
  }
}

export async function listVaultNoteTargets(): Promise<VaultNoteTarget[]> {
  const root = await ensureNotesDirectory();
  const tree = await loadNotesTree(root);
  const notes: VaultNoteTarget[] = [];
  flattenNotes(tree, root, notes);
  return notes.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createAiNote(content: string, metadata: AiCaptureMetadata): Promise<VaultCaptureResult> {
  if (!content.trim()) throw new Error("There is no response content to save.");
  const dir = await ensureAiNotesDirectory();
  const title = cleanTitleCandidate(metadata.title || "") || inferCaptureTitle(content, metadata.kind);
  const destination = await uniqueNotePath(dir, title);
  const contents = noteContents(content, title, metadata);
  await writeFile(destination.path, contents);
  return {
    ...destination,
    undo: { kind: "create", path: destination.path, expected: contents },
  };
}

async function currentContents(path: string): Promise<string> {
  return getEditorDocument(path)?.text ?? await readFile(path);
}

async function guardedReplace(path: string, expected: string, replacement: string): Promise<void> {
  const openDocument = getEditorDocument(path);
  if (openDocument) {
    const applied = await replaceEditorDocument(path, expected, replacement);
    if (!applied) throw new Error("The note changed before Husk could update it. Try again.");
    return;
  }
  const current = await readFile(path);
  if (current !== expected) throw new Error("The note changed before Husk could update it. Try again.");
  await writeFile(path, replacement);
}

export async function appendAiNote(
  path: string,
  content: string,
  metadata: AiCaptureMetadata,
): Promise<VaultCaptureResult> {
  if (!content.trim()) throw new Error("There is no response content to append.");
  const before = await currentContents(path);
  const expected = `${before.replace(/\s*$/, "")}${appendContents(path, content, metadata)}`;
  await guardedReplace(path, before, expected);
  return {
    path,
    name: path.split("/").pop() || path,
    undo: { kind: "append", path, before, expected },
  };
}

export async function undoVaultCapture(undo: VaultCaptureUndo): Promise<void> {
  if (undo.kind === "create") {
    if (getEditorDocument(undo.path)) {
      throw new Error("Close the new note before undoing its creation.");
    }
    const current = await readFile(undo.path);
    if (current !== undo.expected) {
      throw new Error("The note has changed, so Husk left the newer content untouched.");
    }
    await deletePath(undo.path);
    return;
  }
  await guardedReplace(undo.path, undo.expected, undo.before);
}

export function notifyVaultChanged(path: string): void {
  window.dispatchEvent(new CustomEvent("husk:vault-changed", { detail: { path } }));
}

export function openVaultNote(path: string): void {
  window.dispatchEvent(new CustomEvent("husk:open-vault-note", { detail: { path } }));
}
