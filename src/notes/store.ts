import { readDir, readFile, writeFile, createDir, deletePath, homeDir } from "../fs";
import { toast } from "../toast";
import { getPrefs } from "../settings/preferences";

export type FileNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  expanded?: boolean;
};

const DEFAULT_NOTES_DIR = ".husk/notes";

export async function getNotesDirectory(): Promise<string> {
  const prefs = getPrefs();
  if (prefs.notesDirectory) {
    return prefs.notesDirectory;
  }
  const home = await homeDir();
  return `${home}/${DEFAULT_NOTES_DIR}`;
}

export async function setNotesDirectory(dir: string) {
  const { setPrefs } = await import("../settings/preferences");
  setPrefs({ notesDirectory: dir });
}

/* ── Pinned notes ───────────────────────────────────────────────────── */

const PINNED_KEY = "huskv2.notes.pinned";
const MAX_PINNED = 5;

export function getPinnedNotes(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function pinNote(path: string) {
  const current = getPinnedNotes();
  if (current.includes(path)) return;
  const next = [path, ...current].slice(0, MAX_PINNED);
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(next));
  } catch {}
}

export function unpinNote(path: string) {
  const next = getPinnedNotes().filter((p) => p !== path);
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(next));
  } catch {}
}

export function isNotePinned(path: string): boolean {
  return getPinnedNotes().includes(path);
}

/* ── Recent notes ───────────────────────────────────────────────────── */

const RECENTS_KEY = "huskv2.notes.recents";
const MAX_RECENTS = 8;

export function getRecentNotes(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function touchRecentNote(path: string) {
  const current = getRecentNotes();
  const next = [path, ...current.filter((p) => p !== path)].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {}
}

export function removeRecentNote(path: string) {
  const next = getRecentNotes().filter((p) => p !== path);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {}
}

/* ── Last viewed note ─────────────────────────────────────────────── */

const LAST_NOTE_KEY = "huskv2.notes.lastViewed";

export function getLastViewedNote(): string | null {
  try {
    return localStorage.getItem(LAST_NOTE_KEY);
  } catch {
    return null;
  }
}

export function setLastViewedNote(path: string | null) {
  try {
    if (path) {
      localStorage.setItem(LAST_NOTE_KEY, path);
    } else {
      localStorage.removeItem(LAST_NOTE_KEY);
    }
  } catch {
    // storage unavailable
  }
}

export async function ensureNotesDirectory(): Promise<string> {
  const dir = await getNotesDirectory();
  
  try {
    await createDir(dir);
  } catch {
    // Directory may already exist
  }
  
  return dir;
}

export async function loadNotesTree(dir: string): Promise<FileNode[]> {
  try {
    const entries = await readDir(dir);
    const nodes: FileNode[] = [];
    
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      
      const node: FileNode = {
        name: entry.name,
        path: entry.path,
        isDirectory: entry.is_dir,
      };
      
      if (entry.is_dir) {
        node.children = await loadNotesTree(entry.path);
      }
      
      nodes.push(node);
    }
    
    // Sort: directories first, then files, alphabetically
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    
    return nodes;
  } catch (e) {
    console.error("Failed to load notes tree:", e);
    return [];
  }
}

export async function readNote(path: string): Promise<string> {
  try {
    return await readFile(path);
  } catch (e) {
    toast({ title: "Failed to read note", variant: "error" });
    return "";
  }
}

export async function writeNote(path: string, contents: string): Promise<void> {
  try {
    await writeFile(path, contents);
  } catch (e) {
    toast({ title: "Failed to save note", variant: "error" });
    throw e;
  }
}

export async function createNote(dir: string, name: string, contents = ""): Promise<string> {
  const path = `${dir}/${name}`;
  try {
    await writeFile(path, contents);
    return path;
  } catch (e) {
    toast({ title: "Failed to create note", variant: "error" });
    throw e;
  }
}

export async function createNoteFolder(dir: string, name: string): Promise<string> {
  const path = `${dir}/${name}`;
  try {
    await createDir(path);
    return path;
  } catch (e) {
    toast({ title: "Failed to create folder", variant: "error" });
    throw e;
  }
}

export async function deleteNote(path: string): Promise<void> {
  try {
    await deletePath(path);
  } catch (e) {
    toast({ title: "Failed to delete", variant: "error" });
    throw e;
  }
}

export function isNoteFile(name: string): boolean {
  return name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".mdx");
}

/* ── Templates ──────────────────────────────────────────────────────── */

export type NoteTemplate = {
  id: string;
  label: string;
  fileName: string;
  contents: string;
};

const BUILTIN_TEMPLATES: NoteTemplate[] = [
  {
    id: "builtin-daily",
    label: "Daily Standup",
    fileName: "daily-{{date}}.md",
    contents: "# Daily Standup — {{date}}\n\n## Yesterday\n\n## Today\n\n## Blockers\n",
  },
  {
    id: "builtin-incident",
    label: "Incident",
    fileName: "incident-{{timestamp}}.md",
    contents: "# Incident Report\n\n## Severity\n\n## Summary\n\n## Timeline\n\n## Root cause\n\n## Resolution\n\n## Follow-ups\n",
  },
  {
    id: "builtin-todo",
    label: "Todo",
    fileName: "todo-{{timestamp}}.md",
    contents: "# Todo\n\n- [ ] \n- [ ] \n- [ ] \n",
  },
];

const CUSTOM_TEMPLATES_KEY = "huskv2.notes.customTemplates";

export function getCustomTemplates(): NoteTemplate[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (t): t is NoteTemplate =>
            t && typeof t.id === "string" && typeof t.label === "string" &&
t.label === "string" && typeof t.fileName === "string" && typeof t.contents === "string"
        )
      : [];
  } catch {
    return [];
  }
}

export function saveCustomTemplates(templates: NoteTemplate[]) {
  try {
    localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates));
  } catch {}
}

export function getAllTemplates(): NoteTemplate[] {
  return [...BUILTIN_TEMPLATES, ...getCustomTemplates()];
}

export function getTemplateById(id: string): NoteTemplate | undefined {
  return getAllTemplates().find((t) => t.id === id);
}

export function addCustomTemplate(template: Omit<NoteTemplate, "id">): NoteTemplate {
  const full: NoteTemplate = { ...template, id: crypto.randomUUID() };
  const current = getCustomTemplates();
  saveCustomTemplates([...current, full]);
  return full;
}

export function updateCustomTemplate(id: string, patch: Partial<Omit<NoteTemplate, "id">>): boolean {
  const current = getCustomTemplates();
  const idx = current.findIndex((t) => t.id === id);
  if (idx === -1) return false;
  current[idx] = { ...current[idx], ...patch };
  saveCustomTemplates(current);
  return true;
}

export function deleteCustomTemplate(id: string): boolean {
  const current = getCustomTemplates();
  const next = current.filter((t) => t.id !== id);
  if (next.length === current.length) return false;
  saveCustomTemplates(next);
  return true;
}

export function applyTemplate(template: NoteTemplate, date: Date = new Date()): { name: string; contents: string } {
  const iso = date.toISOString();
  const dateStr = iso.slice(0, 10);
  const timestamp = String(Date.now());
  const timeStr = iso.slice(11, 19);

  let name = template.fileName
    .replace(/{{date}}/g, dateStr)
    .replace(/{{timestamp}}/g, timestamp)
    .replace(/{{time}}/g, timeStr);

  let contents = template.contents
    .replace(/{{date}}/g, dateStr)
    .replace(/{{timestamp}}/g, timestamp)
    .replace(/{{time}}/g, timeStr);

  return { name, contents };
}

export const NOTE_TEMPLATES = getAllTemplates();

/* ── Full-text search index ───────────────────────────────────────── */

export type NoteSearchResult = {
  path: string;
  name: string;
  preview: string;
  matchesContent: boolean;
};

export async function searchNotesContent(
  dir: string,
  query: string
): Promise<NoteSearchResult[]> {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return [];

  const results: NoteSearchResult[] = [];
  const seen = new Set<string>();

  async function walk(nodes: FileNode[]) {
    for (const node of nodes) {
      if (node.isDirectory && node.children) {
        await walk(node.children);
        continue;
      }
      if (!isNoteFile(node.name)) continue;
      if (seen.has(node.path)) continue;
      seen.add(node.path);

      const nameMatch = fuzzyMatch(node.name, q);
      let contentMatch = false;
      let preview = "";

      if (!nameMatch) {
        try {
          const content = await readFile(node.path);
          const lowerContent = content.toLowerCase();
          const idx = lowerContent.replace(/\s+/g, "").indexOf(q);
          if (idx !== -1) {
            contentMatch = true;
            const realIdx = findOriginalIndex(lowerContent, q, idx);
            const start = Math.max(0, realIdx - 40);
            const end = Math.min(content.length, realIdx + q.length + 60);
            preview = (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
          }
        } catch {
          // ignore unreadable files
        }
      }

      if (nameMatch || contentMatch) {
        results.push({
          path: node.path,
          name: node.name,
          preview: nameMatch ? "" : preview,
          matchesContent: contentMatch,
        });
      }
    }
  }

  const tree = await loadNotesTree(dir);
  await walk(tree);
  return results;
}

function fuzzyMatch(text: string, query: string): boolean {
  const t = text.toLowerCase();
  let i = 0;
  for (const char of query) {
    i = t.indexOf(char, i);
    if (i === -1) return false;
    i++;
  }
  return true;
}

function findOriginalIndex(lowerContent: string, _query: string, compressedIdx: number): number {
  // compressedIdx is the index in the whitespace-stripped version; map back to original index
  let compressed = 0;
  for (let i = 0; i < lowerContent.length; i++) {
    if (/\s/.test(lowerContent[i])) continue;
    if (compressed === compressedIdx) return i;
    compressed++;
  }
  return 0;
}
