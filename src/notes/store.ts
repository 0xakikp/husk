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

export async function createNote(dir: string, name: string): Promise<string> {
  const path = `${dir}/${name}`;
  try {
    await writeFile(path, "");
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
