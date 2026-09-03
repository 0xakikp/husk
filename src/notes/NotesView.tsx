import { useState, useEffect, useRef, useCallback, useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PlusSignIcon,
  Delete02Icon,
  Search01Icon,
  FileEditIcon,
  PinIcon,
  PinOffIcon,
  Clock01Icon,
  File02Icon,
  ArrowRight01Icon,
  PencilEdit01Icon,
  Cancel01Icon,
  InformationCircleIcon,
  NotebookIcon,
  SparklesIcon,
  ClipboardPasteIcon,
  Copy01Icon,
  Edit02Icon,
  Folder01Icon,
  Move01Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { PanelHeader } from "../shell/PanelHeader";
import { folderIconUrl } from "../explorer/iconResolver";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  loadNotesTree,
  readNote,
  writeNote,
  createNote,
  createNoteFolder,
  copyNotePath,
  deleteNote,
  ensureNotesDirectory,
  isNoteFile,
  moveNotePath,
  getLastViewedNote,
  setLastViewedNote,
  pinNote,
  unpinNote,
  isNotePinned,
  touchRecentNote,
  getPinnedNotes,
  getRecentNoteEntries,
  searchNotesContent,
  getAllTemplates,
  getTemplateById,
  applyTemplate,
  addCustomTemplate,
  updateCustomTemplate,
  deleteCustomTemplate,
  type FileNode,
  type NoteSearchResult,
  type NoteTemplate,
  type RecentNote,
} from "./store";
import { toast } from "../toast";
import { createPortal } from "react-dom";
import { sheetHost } from "../components/sheetHost";
import { getEditorDocument, replaceEditorDocument } from "../ai/editorStore";
import { readFile } from "../fs";
import { buildVaultIndex, rankVaultSections, type VaultLensResult } from "./vaultLens";
import { expandVaultLensQuery, organizeNoteWithAi } from "./notesAi";
import { NoteOrganizeReview } from "./NoteOrganizeReview";
import { getFileState } from "../editor/dirtyStore";
import {
  isVaultPathWithin,
  normalizedVaultName,
  replaceVaultPath,
  vaultJoin,
  vaultNameError,
  vaultParent,
} from "./vaultPaths";
import {
  huskContextMenuContentClass,
  huskContextMenuDangerClass,
  huskContextMenuItemClass,
} from "../components/HuskContextMenu";

function noteTitle(name: string): string {
  return name.replace(/\.(md|mdx|txt)$/i, "");
}

function noteFolder(path: string, root: string): string {
  const parent = path.slice(0, Math.max(0, path.lastIndexOf("/")));
  if (!root || parent === root) return "Vault";
  const relative = parent.startsWith(`${root}/`) ? parent.slice(root.length + 1) : parent;
  return relative || "Vault";
}

function lastOpenedLabel(openedAt?: number): string {
  if (!openedAt) return "recently opened";
  const elapsed = Math.max(0, Date.now() - openedAt);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function notesInTree(nodes?: FileNode[]): number {
  if (!nodes) return 0;
  return nodes.reduce(
    (total, node) => total + (node.isDirectory ? notesInTree(node.children) : isNoteFile(node.name) ? 1 : 0),
    0,
  );
}

function notePathsInTree(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  const walk = (entries: FileNode[]) => {
    for (const entry of entries) {
      if (entry.isDirectory) walk(entry.children ?? []);
      else if (isNoteFile(entry.name)) paths.push(entry.path);
    }
  };
  walk(nodes);
  return paths;
}

type VaultContextTarget = {
  kind: "root" | "folder" | "note" | "file";
  path: string;
  name: string;
  isDirectory: boolean;
};

type VaultContextState = {
  x: number;
  y: number;
  target: VaultContextTarget;
};

type VaultClipboard = {
  operation: "copy" | "move";
  target: VaultContextTarget;
};

function VaultContextAction({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        huskContextMenuItemClass,
        danger && huskContextMenuDangerClass,
      )}
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={1.7} className="shrink-0 opacity-80" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function VaultContextDivider() {
  return <div className="husk-context-menu-separator" />;
}

export function NotesView({ 
  inline,
  onOpenFile,
}: { 
  inline?: boolean;
  onOpenFile?: (path: string, name: string) => void;
}) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [searchResults, setSearchResults] = useState<NoteSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [lensMode, setLensMode] = useState(false);
  const [lensResults, setLensResults] = useState<VaultLensResult[]>([]);
  const [lensNotice, setLensNotice] = useState("");
  const lensRequestRef = useRef(0);
  const [organizing, setOrganizing] = useState(false);
  const [applyingOrganization, setApplyingOrganization] = useState(false);
  const [organizeReview, setOrganizeReview] = useState<{
    path: string;
    name: string;
    original: string;
    organized: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateLabel, setTemplateLabel] = useState("");
  const [templateFileName, setTemplateFileName] = useState("");
  const [templateContents, setTemplateContents] = useState("");
  const [templates, setTemplates] = useState<NoteTemplate[]>(getAllTemplates);
  const [pinned, setPinned] = useState<string[]>([]);
  const [recents, setRecents] = useState<RecentNote[]>([]);
  const [activeNotePath, setActiveNotePath] = useState<string | null>(() => getLastViewedNote());
  const [vaultContext, setVaultContext] = useState<VaultContextState | null>(null);
  const [vaultClipboard, setVaultClipboard] = useState<VaultClipboard | null>(null);
  const [renameTarget, setRenameTarget] = useState<VaultContextTarget | null>(null);
  const [renameName, setRenameName] = useState("");

  useEffect(() => {
    if (!vaultContext) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVaultContext(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [vaultContext]);

  /* ── Helpers ─────────────────────────────────────────────────────── */

  function getParentPaths(filePath: string, rootDir: string): string[] {
    const parents: string[] = [];
    let current = filePath;
    while (current !== rootDir && current.length > rootDir.length) {
      const lastSlash = current.lastIndexOf("/");
      if (lastSlash === -1) break;
      current = current.substring(0, lastSlash);
      if (current !== rootDir) {
        parents.unshift(current);
      }
    }
    return parents;
  }
  const [createType, setCreateType] = useState<"file" | "folder">("file");
  const [createName, setCreateName] = useState("");
  const [createDir, setCreateDir] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notesDirRef = useRef<string>("");

  const refreshTemplates = useCallback(() => {
    setTemplates(getAllTemplates());
  }, []);

  const loadLists = useCallback(() => {
    setPinned(getPinnedNotes());
    setRecents(getRecentNoteEntries());
  }, []);

  const loadTree = useCallback(async () => {
    setLoading(true);
    const dir = await ensureNotesDirectory();
    notesDirRef.current = dir;
    const nodes = await loadNotesTree(dir);
    setTree(nodes);
    
    // Auto-expand to last viewed note
    const lastViewed = getLastViewedNote();
    if (lastViewed) {
      const parentPaths = getParentPaths(lastViewed, dir);
      if (parentPaths.length > 0) {
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const p of parentPaths) {
            next.add(p);
          }
          return next;
        });
      }
    }
    
    loadLists();
    refreshTemplates();
    setLoading(false);
  }, [loadLists, refreshTemplates]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    const refreshVault = () => {
      void loadTree();
    };
    window.addEventListener("husk:vault-changed", refreshVault);
    return () => window.removeEventListener("husk:vault-changed", refreshVault);
  }, [loadTree]);

  // Fast literal search stays live while typing. Vault Lens is explicitly run
  // with Enter so a natural-language query never triggers a provider request
  // for every keystroke.
  useEffect(() => {
    if (lensMode) {
      setSearching(false);
      return;
    }
    if (!search.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setSearching(true);
      const results = await searchNotesContent(notesDirRef.current, search);
      if (!cancelled) {
        setSearchResults(results);
        setSearching(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [search, lensMode]);

  const toggleExpanded = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleOpenNote = async (path: string, line?: number) => {
    setLastViewedNote(path);
    setActiveNotePath(path);
    touchRecentNote(path);
    loadLists();
    if (onOpenFile) {
      const name = path.split("/").pop() || path;
      onOpenFile(path, name);
      if (line && line > 0) {
        window.dispatchEvent(new CustomEvent("husk:reveal-line", { detail: { path, line } }));
      }
    } else {
      // Fallback: read and show in a simple modal if no editor available
      const content = await readNote(path);
      setEditingFile(path);
      setEditContent(content);
    }
  };

  const runVaultLens = useCallback(async () => {
    const query = search.trim();
    if (!query || !notesDirRef.current) return;
    const requestId = ++lensRequestRef.current;
    setSearching(true);
    setLensNotice("");
    try {
      const sections = await buildVaultIndex(notesDirRef.current);
      let expansion: string[] = [];
      try {
        expansion = await expandVaultLensQuery(query);
      } catch {
        /* Lens remains useful offline or before an AI provider is configured:
           direct section ranking is the privacy-preserving fallback. */
        if (requestId === lensRequestRef.current) {
          setLensNotice("AI expansion unavailable · showing private local matches");
        }
      }
      if (requestId !== lensRequestRef.current) return;
      setLensResults(rankVaultSections(sections, query, expansion));
    } catch (error) {
      if (requestId !== lensRequestRef.current) return;
      setLensResults([]);
      setLensNotice(error instanceof Error ? error.message : "Vault Lens could not search these notes.");
    } finally {
      if (requestId === lensRequestRef.current) setSearching(false);
    }
  }, [search]);

  const handleOrganizeNote = useCallback(async () => {
    const path = activeNotePath;
    if (!path || organizing) return;
    setOrganizing(true);
    try {
      const openDocument = getEditorDocument(path);
      const original = openDocument?.text ?? await readFile(path);
      if (!original.trim()) {
        toast({ title: "This note is empty", message: "Add some text before organizing it.", variant: "info" });
        return;
      }
      const name = path.split("/").pop() || path;
      const organized = await organizeNoteWithAi(name, original);
      if (organized.trim() === original.trim()) {
        toast({ title: "This note is already organized", variant: "success" });
        return;
      }
      setOrganizeReview({ path, name, original, organized });
    } catch (error) {
      toast({
        title: "Could not organize note",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      });
    } finally {
      setOrganizing(false);
    }
  }, [activeNotePath, organizing]);

  const applyOrganizedNote = useCallback(async () => {
    const review = organizeReview;
    if (!review || applyingOrganization) return;
    setApplyingOrganization(true);
    try {
      const openDocument = getEditorDocument(review.path);
      if (openDocument) {
        const applied = await replaceEditorDocument(review.path, review.original, review.organized);
        if (!applied) throw new Error("The note changed after this review was created. Organize it again to avoid overwriting newer edits.");
      } else {
        const current = await readFile(review.path);
        if (current !== review.original) {
          throw new Error("The note changed after this review was created. Organize it again to avoid overwriting newer edits.");
        }
        await writeNote(review.path, review.organized);
      }
      setOrganizeReview(null);
      toast({ title: "Organized note applied", message: "The reviewed Markdown is now saved.", variant: "success" });
    } catch (error) {
      toast({
        title: "Could not apply organized note",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      });
    } finally {
      setApplyingOrganization(false);
    }
  }, [applyingOrganization, organizeReview]);

  const handleSaveNote = async () => {
    if (!editingFile) return;
    try {
      await writeNote(editingFile, editContent);
      toast({ title: "Note saved", variant: "success" });
    } catch {
      // error handled in store
    }
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    const dir = createDir || notesDirRef.current;
    try {
      if (createType === "folder") {
        await createNoteFolder(dir, createName.trim());
      } else {
        const name = createName.trim();
        const finalName = name.endsWith(".md") || name.endsWith(".txt") ? name : `${name}.md`;
        await createNote(dir, finalName);
      }
      setShowCreate(false);
      setCreateName("");
      setCreateDir("");
      await loadTree();
      toast({ title: createType === "folder" ? "Folder created" : "Note created", variant: "success" });
    } catch {
      // error handled in store
    }
  };

  const handleCreateFromTemplate = async (templateId: string) => {
    const dir = notesDirRef.current;
    const template = getTemplateById(templateId);
    if (!template) return;
    try {
      const { name, contents } = applyTemplate(template);
      const path = await createNote(dir, name, contents);
      setShowTemplatePicker(false);
      await loadTree();
      await handleOpenNote(path);
      toast({ title: `Created ${template.label}`, variant: "success" });
    } catch {
      // error handled in store
    }
  };

  const startTemplateEdit = (template: NoteTemplate) => {
    setEditingTemplateId(template.id);
    setTemplateLabel(template.label);
    setTemplateFileName(template.fileName);
    setTemplateContents(template.contents);
    setShowTemplateEditor(true);
  };

  const startNewTemplate = () => {
    setEditingTemplateId(null);
    setTemplateLabel("");
    setTemplateFileName("{{date}}.md");
    setTemplateContents("");
    setShowTemplateEditor(true);
  };

  const handleSaveTemplate = () => {
    if (!templateLabel.trim() || !templateFileName.trim()) return;
    if (editingTemplateId) {
      updateCustomTemplate(editingTemplateId, {
        label: templateLabel.trim(),
        fileName: templateFileName.trim(),
        contents: templateContents,
      });
      toast({ title: "Template updated", variant: "success" });
    } else {
      addCustomTemplate({
        label: templateLabel.trim(),
        fileName: templateFileName.trim(),
        contents: templateContents,
      });
      toast({ title: "Template created", variant: "success" });
    }
    refreshTemplates();
    setShowTemplateEditor(false);
  };

  const handleDeleteTemplate = (id: string) => {
    if (!confirm("Delete this template?")) return;
    deleteCustomTemplate(id);
    refreshTemplates();
    toast({ title: "Template deleted", variant: "success" });
  };

  const handleDelete = async (path: string, name: string) => {
    const unsaved = notePathsInTree(tree).find((candidate) => (
      isVaultPathWithin(candidate, path) && getFileState(candidate) !== "clean"
    ));
    if (unsaved) {
      toast({
        title: "Save this note first",
        message: `${unsaved.split("/").pop() || unsaved} has unsaved changes and would be deleted.`,
        variant: "info",
      });
      return;
    }
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteNote(path);
      loadLists();
      await loadTree();
      if (editingFile && isVaultPathWithin(editingFile, path)) {
        setEditingFile(null);
        setEditContent("");
      }
      if (activeNotePath && isVaultPathWithin(activeNotePath, path)) setActiveNotePath(null);
      window.dispatchEvent(new CustomEvent("husk:vault-path-deleted", { detail: { path } }));
      toast({ title: "Deleted", variant: "success" });
    } catch {
      // error handled in store
    }
  };

  const togglePin = (path: string) => {
    if (isNotePinned(path)) {
      unpinNote(path);
    } else {
      pinNote(path);
    }
    loadLists();
  };

  const fuzzyMatch = (text: string, query: string): boolean => {
    const t = text.toLowerCase();
    const q = query.toLowerCase().replace(/\s+/g, "");
    let i = 0;
    for (const char of q) {
      i = t.indexOf(char, i);
      if (i === -1) return false;
      i++;
    }
    return true;
  };

  const filterTree = (nodes: FileNode[], query: string): FileNode[] => {
    if (!query.trim()) return nodes;
    const result: FileNode[] = [];
    for (const node of nodes) {
      if (fuzzyMatch(node.name, query)) {
        result.push(node);
      } else if (node.children) {
        const filtered = filterTree(node.children, query);
        if (filtered.length > 0) {
          result.push({ ...node, children: filtered, expanded: true });
        }
      }
    }
    return result;
  };

  const filteredTree = useMemo(
    () => (search.trim() ? filterTree(tree, search) : tree),
    [tree, search]
  );

  const allNotePaths = useMemo(() => {
    return notePathsInTree(tree);
  }, [tree]);

  const folderCount = useMemo(() => {
    let count = 0;
    function walk(nodes: FileNode[]) {
      for (const node of nodes) {
        if (!node.isDirectory) continue;
        count += 1;
        if (node.children) walk(node.children);
      }
    }
    walk(tree);
    return count;
  }, [tree]);

  const pinnedInfo = useMemo(() => {
    return pinned
      .filter((p) => allNotePaths.includes(p))
      .map((p) => ({ path: p, name: p.split("/").pop() || p }));
  }, [pinned, allNotePaths]);

  const recentsInfo = useMemo(() => {
    return recents
      .filter((entry) => allNotePaths.includes(entry.path) && !pinned.includes(entry.path))
      .map((entry) => ({ ...entry, name: entry.path.split("/").pop() || entry.path }))
      .slice(0, 5);
  }, [recents, allNotePaths, pinned]);

  const rootContextTarget = useCallback((): VaultContextTarget | null => {
    const path = notesDirRef.current;
    return path ? { kind: "root", path, name: "Vault", isDirectory: true } : null;
  }, []);

  const openVaultContext = useCallback((event: ReactMouseEvent, target: VaultContextTarget) => {
    event.preventDefault();
    event.stopPropagation();
    const width = 196;
    const height = target.kind === "note" ? 278 : target.kind === "folder" ? 324 : 208;
    setVaultContext({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      target,
    });
  }, []);

  const beginCreate = useCallback((directory: string, type: "file" | "folder") => {
    setVaultContext(null);
    setCreateType(type);
    setCreateDir(directory);
    setCreateName("");
    setShowCreate(true);
  }, []);

  const unsavedPathWithin = useCallback((path: string): string | null => {
    return allNotePaths.find((candidate) => (
      isVaultPathWithin(candidate, path) && getFileState(candidate) !== "clean"
    )) ?? null;
  }, [allNotePaths]);

  const beginClipboardOperation = useCallback((target: VaultContextTarget, operation: VaultClipboard["operation"]) => {
    const unsaved = unsavedPathWithin(target.path);
    if (unsaved) {
      toast({
        title: "Save this note first",
        message: `${unsaved.split("/").pop() || unsaved} has unsaved changes. Save it before ${operation === "copy" ? "copying" : "moving"}.`,
        variant: "info",
      });
      setVaultContext(null);
      return;
    }
    setVaultClipboard({ target, operation });
    setVaultContext(null);
    toast({
      title: operation === "copy" ? `Copied ${target.name}` : `Ready to move ${target.name}`,
      message: "Right-click a destination folder and choose Paste here.",
      variant: "info",
    });
  }, [unsavedPathWithin]);

  const applyMovedPath = useCallback((from: string, to: string) => {
    setActiveNotePath((current) => current ? replaceVaultPath(current, from, to) : null);
    setEditingFile((current) => current ? replaceVaultPath(current, from, to) : null);
    window.dispatchEvent(new CustomEvent("husk:vault-path-moved", { detail: { from, to } }));
  }, []);

  const pasteVaultClipboard = useCallback(async (directory: string) => {
    const clipboard = vaultClipboard;
    if (!clipboard) return;
    setVaultContext(null);
    const destination = vaultJoin(directory, clipboard.target.name);
    if (destination === clipboard.target.path) {
      toast({ title: "Choose a different folder", message: "The item is already in this folder.", variant: "info" });
      return;
    }
    if (clipboard.target.isDirectory && isVaultPathWithin(directory, clipboard.target.path)) {
      toast({ title: "Choose a different folder", message: "A folder cannot be placed inside itself.", variant: "error" });
      return;
    }
    try {
      if (clipboard.operation === "copy") {
        await copyNotePath(clipboard.target.path, destination);
        toast({ title: `Copied ${clipboard.target.name}`, message: `To ${directory}`, variant: "success" });
      } else {
        await moveNotePath(clipboard.target.path, destination);
        applyMovedPath(clipboard.target.path, destination);
        setVaultClipboard(null);
        toast({ title: `Moved ${clipboard.target.name}`, message: `To ${directory}`, variant: "success" });
      }
      setExpanded((current) => new Set(current).add(directory));
      await loadTree();
      loadLists();
    } catch {
      // The store reports the native filesystem error without replacing files.
    }
  }, [applyMovedPath, loadLists, loadTree, vaultClipboard]);

  const beginRename = useCallback((target: VaultContextTarget) => {
    setVaultContext(null);
    setRenameTarget(target);
    setRenameName(target.isDirectory ? target.name : noteTitle(target.name));
  }, []);

  const confirmRename = useCallback(async () => {
    const target = renameTarget;
    if (!target) return;
    const error = vaultNameError(renameName);
    if (error) {
      toast({ title: "Enter a valid name", message: error, variant: "error" });
      return;
    }
    const name = normalizedVaultName(target.name, renameName, target.isDirectory);
    const destination = vaultJoin(vaultParent(target.path), name);
    if (destination === target.path) {
      setRenameTarget(null);
      return;
    }
    const unsaved = unsavedPathWithin(target.path);
    if (unsaved) {
      toast({ title: "Save this note first", message: `${unsaved.split("/").pop() || unsaved} has unsaved changes.`, variant: "info" });
      return;
    }
    try {
      await moveNotePath(target.path, destination);
      applyMovedPath(target.path, destination);
      setRenameTarget(null);
      setRenameName("");
      await loadTree();
      loadLists();
      toast({ title: `Renamed to ${name}`, variant: "success" });
    } catch {
      // The store reports conflicts and filesystem failures.
    }
  }, [applyMovedPath, loadLists, loadTree, renameName, renameTarget, unsavedPathWithin]);

  const copyVaultPath = useCallback(async (path: string) => {
    setVaultContext(null);
    try {
      await writeText(path);
      toast({ title: "Vault path copied", variant: "success" });
    } catch (error) {
      toast({ title: "Could not copy the path", message: String(error), variant: "error" });
    }
  }, []);

  const renderNode = (node: FileNode, depth: number) => {
    const isExpanded = expanded.has(node.path) || node.expanded;
    const isActive = activeNotePath === node.path;
    const indent = { paddingLeft: 7 + depth * 14 };

    return (
      <div key={node.path}>
        <div className="group relative">
          {node.isDirectory ? (
            <button
              type="button"
              data-vault-item
              className="flex h-7 w-full items-center gap-1.5 pr-2 text-left font-mono text-[11px] font-medium text-foreground/90 transition-colors hover:bg-muted/45"
              style={indent}
              onClick={() => toggleExpanded(node.path)}
              onContextMenu={(event) => openVaultContext(event, { kind: "folder", path: node.path, name: node.name, isDirectory: true })}
            >
              <span className="inline-flex w-3 shrink-0 justify-center text-[9px] text-muted-foreground/60">{isExpanded ? "▾" : "▸"}</span>
              <img src={folderIconUrl(node.name, !!isExpanded)} className="size-3.5 shrink-0" alt="" draggable={false} />
              <span className="truncate">{node.name}</span>
              <span className="ml-auto text-[9px] font-normal text-muted-foreground/50">{notesInTree(node.children)}</span>
            </button>
          ) : (
            <button
              type="button"
              data-vault-item
              className={cn(
                "flex h-7 w-full items-center gap-1.5 border-l-2 border-transparent pr-2 text-left font-mono text-[11px] text-foreground/80 transition-colors hover:bg-muted/45 hover:text-foreground",
                isActive && "border-primary bg-primary/[0.08] text-foreground",
              )}
              style={indent}
              onClick={() => {
                if (isNoteFile(node.name)) handleOpenNote(node.path);
              }}
              onContextMenu={(event) => openVaultContext(event, {
                kind: isNoteFile(node.name) ? "note" : "file",
                path: node.path,
                name: node.name,
                isDirectory: false,
              })}
              title={isNoteFile(node.name) ? "Open in editor" : node.name}
            >
              <span className="w-3 shrink-0" />
              <HugeiconsIcon icon={File02Icon} size={12} strokeWidth={1.6} className={cn("shrink-0 text-muted-foreground/65", isActive && "text-primary")} />
              <span className="truncate">{noteTitle(node.name)}</span>
            </button>
          )}

          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {node.isDirectory && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCreateType("file");
                  setCreateDir(node.path);
                  setShowCreate(true);
                }}
                className="rounded p-0.5 bg-[var(--bg-2)] hover:bg-foreground/10"
                title="New note"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={9} />
              </button>
            )}
            {!node.isDirectory && isNoteFile(node.name) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePin(node.path);
                }}
                className={cn(
                  "rounded p-0.5 bg-[var(--bg-2)] hover:bg-foreground/10",
                  isNotePinned(node.path) && "text-primary opacity-100"
                )}
                title={isNotePinned(node.path) ? "Unpin note" : "Pin note"}
              >
                <HugeiconsIcon icon={PinIcon} size={9} />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(node.path, node.name);
              }}
              className="rounded p-0.5 bg-[var(--bg-2)] hover:bg-foreground/10 text-destructive"
              title="Delete"
            >
              <HugeiconsIcon icon={Delete02Icon} size={9} />
            </button>
          </div>
        </div>

        {node.isDirectory && isExpanded && node.children && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  const renderQuickNote = (item: { path: string; name: string; openedAt?: number }, pinnedNote = false) => {
    const isActive = activeNotePath === item.path;
    return (
      <div
        key={item.path}
        data-vault-item
        className={cn(
          /* Recent notes are list rows, not content-sized chips. Keep the
             selection aligned with the list while tightening each row's
             vertical rhythm so recents stay compact and scannable. */
          "group mx-1 flex min-h-8 cursor-pointer items-center gap-1.5 border-l-2 border-transparent py-0 pl-2 pr-1 transition-colors hover:bg-muted/45",
          isActive && !pinnedNote && "rounded-md border border-l-2 border-primary/55 border-l-primary bg-primary/[0.08] shadow-[inset_2px_0_0_var(--primary)]",
          isActive && pinnedNote && "border-primary bg-primary/[0.08]",
        )}
        onClick={() => handleOpenNote(item.path)}
        onContextMenu={(event) => openVaultContext(event, { kind: "note", path: item.path, name: item.name, isDirectory: false })}
      >
        <HugeiconsIcon icon={File02Icon} size={13} strokeWidth={1.6} className={cn("shrink-0 text-muted-foreground/65", isActive && "text-primary")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[11px] text-foreground">{noteTitle(item.name)}</span>
          <span className="block truncate text-[9px] leading-3 text-muted-foreground/65">{noteFolder(item.path, notesDirRef.current)}</span>
        </span>
        {!pinnedNote && <span className="shrink-0 font-mono text-[9px] text-muted-foreground/55">{lastOpenedLabel(item.openedAt)}</span>}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            togglePin(item.path);
          }}
          className={cn("rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground", pinnedNote && "text-primary")}
          title={pinnedNote ? "Unpin note" : "Pin note"}
        >
          <HugeiconsIcon icon={pinnedNote ? PinOffIcon : PinIcon} size={8} />
        </button>
      </div>
    );
  };

  const searchIsActive = searchActive && search.trim().length > 0;
  const builtinTemplateIds = useMemo(() => new Set(["builtin-daily", "builtin-incident", "builtin-todo"]), []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("box-border flex h-full min-h-0 flex-col", inline ? "p-2" : "p-4")}>
        {/* Header */}
        <PanelHeader
          icon={NotebookIcon}
          title="Notes"
          className={inline ? "-mx-2 -mt-2 mb-3" : "-mx-4 -mt-4 mb-3"}
          actions={
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex size-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground"
                    aria-label="What is this?"
                  >
                    <HugeiconsIcon icon={InformationCircleIcon} size={14} strokeWidth={1.75} />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={6}
                  className="max-w-[220px] border border-border/60 bg-zinc-950 text-zinc-100 text-[10.5px] p-2 shadow-lg"
                >
                  Markdown notes tied to the workspace. Pin important notes, search content, and create new notes from templates.
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                onClick={() => setShowTemplatePicker(true)}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                title="New note from template"
              >
                <HugeiconsIcon icon={File02Icon} size={14} />
              </button>
              {activeNotePath && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => void handleOrganizeNote()}
                      disabled={organizing}
                      className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-45"
                      aria-label="Organize current note with AI"
                    >
                      <HugeiconsIcon icon={SparklesIcon} size={14} className={organizing ? "animate-pulse" : undefined} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={6} className="border border-border/60 bg-zinc-950 text-[10px] text-zinc-100">
                    Organize note · review the Markdown diff before applying
                  </TooltipContent>
                </Tooltip>
              )}
              {tree.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSearchActive(true)}
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground",
                    searchActive && "bg-muted/60 text-foreground"
                  )}
                  title="Search notes"
                >
                  <HugeiconsIcon icon={Search01Icon} size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setCreateType("file");
                  setCreateDir(notesDirRef.current);
                  setShowCreate(true);
                }}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                title="New note"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
              </button>
            </>
          }
        />

      {/* Search */}
      {searchActive && (
        <div className="mb-2">
          <div className="flex h-7 items-center rounded-md border border-border/45 bg-muted/25 p-0.5 focus-within:border-primary/45">
            <HugeiconsIcon icon={Search01Icon} size={10} className="ml-1.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (lensMode) {
                  lensRequestRef.current += 1;
                  setLensResults([]);
                  setLensNotice("");
                  setSearching(false);
                }
              }}
              onBlur={() => {
                if (!search) setSearchActive(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  lensRequestRef.current += 1;
                  setSearch("");
                  setLensResults([]);
                  setSearchActive(false);
                } else if (e.key === "Enter" && lensMode) {
                  e.preventDefault();
                  void runVaultLens();
                }
              }}
              placeholder={lensMode ? "Ask Vault Lens…" : "Search names & content…"}
              className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[10px] text-foreground outline-none"
              autoFocus
            />
            <button
              type="button"
              className={cn(
                "flex h-5 shrink-0 items-center gap-1 rounded px-1.5 font-mono text-[8px] uppercase tracking-wide text-muted-foreground transition-all hover:bg-muted hover:text-foreground",
                lensMode && "border border-primary/35 bg-primary/10 text-primary",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                lensRequestRef.current += 1;
                setLensMode((current) => !current);
                setLensResults([]);
                setLensNotice("");
                setSearching(false);
              }}
              title={lensMode ? "Use instant text search" : "Search notes by meaning"}
            >
              <HugeiconsIcon icon={SparklesIcon} size={9} />
              Lens
            </button>
          </div>
          {lensMode && (
            <div className="mt-1 flex items-center px-1 font-mono text-[8px] text-muted-foreground/70">
              <span className="truncate">Search by meaning · Enter to run</span>
              {search.trim() && (
                <button
                  type="button"
                  className="ml-auto shrink-0 text-primary hover:underline disabled:opacity-40"
                  disabled={searching}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void runVaultLens()}
                >
                  {searching ? "thinking…" : "search ↵"}
                </button>
              )}
            </div>
          )}
          {lensNotice && <p className="mt-1 px-1 font-mono text-[8px] leading-3 text-amber-400/75">{lensNotice}</p>}
        </div>
      )}

      {/* Pinned notes and recent activity stay separate from the folder tree:
          recents answer “what was I working on?”, browse answers “where is it?”. */}
      {!searchIsActive && !loading && (
        <div className="mb-3 flex flex-col gap-3">
          {pinnedInfo.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">
                <HugeiconsIcon icon={PinIcon} size={8} />
                Pinned
              </div>
              <div>{pinnedInfo.map((item) => renderQuickNote(item, true))}</div>
            </div>
          )}
          {recentsInfo.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">
                <HugeiconsIcon icon={Clock01Icon} size={8} />
                Recently opened
                <span className="ml-auto text-muted-foreground/45">{recentsInfo.length}</span>
              </div>
              <div>{recentsInfo.map((item) => renderQuickNote(item))}</div>
            </div>
          )}
        </div>
      )}

      {/* Tree / Search results */}
      <div
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest("[data-vault-item]")) return;
          const target = rootContextTarget();
          if (target) openVaultContext(event, target);
        }}
      >
        {loading || searching ? (
          <div className="py-4 text-center text-[11px] text-muted-foreground">{searching ? (lensMode ? "Searching by meaning…" : "Searching…") : "Loading…"}</div>
        ) : searchIsActive ? (
          (lensMode ? lensResults : searchResults).length === 0 ? (
            <div className="px-3 py-4 text-center text-[10px] leading-4 text-muted-foreground">
              {lensMode ? "Press Enter to search, or try a more specific question." : "No matches."}
            </div>
          ) : lensMode ? (
            <div className="flex flex-col gap-0.5">
              {lensResults.map((result) => (
                <button
                  type="button"
                  data-vault-item
                  key={result.id}
                  className={cn(
                    "group flex w-full flex-col gap-1 rounded-md border border-transparent px-2 py-2 text-left transition-colors hover:border-primary/25 hover:bg-primary/[0.06]",
                    activeNotePath === result.path && "border-primary/30 bg-primary/[0.07]",
                  )}
                  onClick={() => void handleOpenNote(result.path, result.startLine)}
                  onContextMenu={(event) => openVaultContext(event, { kind: "note", path: result.path, name: result.name, isDirectory: false })}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <HugeiconsIcon icon={File02Icon} size={12} className="shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium text-foreground">{noteTitle(result.name)}</span>
                    <span className="shrink-0 font-mono text-[8px] text-muted-foreground/60">L{result.startLine}</span>
                  </span>
                  <span className="truncate pl-[18px] font-mono text-[9px] text-primary/80">§ {result.heading}</span>
                  <span className="line-clamp-3 pl-[18px] text-[9px] leading-3.5 text-muted-foreground">{result.preview}</span>
                  {result.matchedTerms.length > 0 && (
                    <span className="truncate pl-[18px] font-mono text-[8px] text-muted-foreground/50">matched · {result.matchedTerms.join(" · ")}</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              {searchResults.map((r) => (
                <div
                  key={r.path}
                  data-vault-item
                  className={cn(
                    "group flex cursor-pointer flex-col gap-0.5 border-l-2 border-transparent px-2 py-1.5 hover:bg-muted/45",
                    activeNotePath === r.path && "border-primary bg-primary/[0.08]",
                  )}
                  onClick={() => handleOpenNote(r.path)}
                  onContextMenu={(event) => openVaultContext(event, { kind: "note", path: r.path, name: r.name, isDirectory: false })}
                >
                  <div className="flex items-center gap-1.5">
                    <HugeiconsIcon icon={File02Icon} size={12} strokeWidth={1.6} className="shrink-0 text-muted-foreground/65" />
                    <span className="flex-1 min-w-0 truncate font-mono text-[11px] font-medium text-foreground">{noteTitle(r.name)}</span>
                    {r.matchesContent && (
                      <span className="text-[8px] px-1 rounded bg-primary/10 text-primary">content</span>
                    )}
                  </div>
                  {r.preview && (
                    <p className="text-[9px] text-muted-foreground line-clamp-2 pl-5">{r.preview}</p>
                  )}
                </div>
              ))}
            </div>
          )
        ) : filteredTree.length === 0 ? (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            {search ? "No matches." : "No notes. Click + to create."}
          </div>
        ) : (
          <>
            <div className="mb-1 flex items-center px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">
              Browse
              <span className="ml-auto text-muted-foreground/45">{folderCount} folders</span>
            </div>
            {filteredTree.map((node) => renderNode(node, 0))}
          </>
        )}
      </div>

      {!searchIsActive && !loading && (
        <div className="mt-1 flex h-4 shrink-0 items-center border-t border-border/55 px-2 font-mono text-[9px] leading-none text-muted-foreground/60">
          <span>{allNotePaths.length} notes</span>
          <span className="px-1.5 text-muted-foreground/35">·</span>
          <span>{folderCount} {folderCount === 1 ? "folder" : "folders"}</span>
          {vaultClipboard && (
            <button
              type="button"
              onClick={() => setVaultClipboard(null)}
              className="ml-auto flex min-w-0 items-center gap-1 text-primary/75 hover:text-primary"
              title={`Cancel ${vaultClipboard.operation}: ${vaultClipboard.target.name}`}
            >
              <span className="max-w-20 truncate">{vaultClipboard.operation}: {vaultClipboard.target.name}</span>
              <HugeiconsIcon icon={Cancel01Icon} size={8} className="shrink-0" />
            </button>
          )}
        </div>
      )}

      {vaultContext && createPortal(
        <>
          <div
            className="fixed inset-0 z-[80]"
            onClick={() => setVaultContext(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setVaultContext(null);
            }}
          />
          <div
            role="menu"
            aria-label={`${vaultContext.target.name} actions`}
            className={cn(huskContextMenuContentClass, "fixed z-[81] w-[196px]")}
            style={{ left: vaultContext.x, top: vaultContext.y }}
          >
            <div className="husk-context-menu-label truncate">
              {vaultContext.target.kind === "root" ? "Vault" : vaultContext.target.name}
            </div>

            {vaultContext.target.kind === "note" && (
              <>
                <VaultContextAction icon={FileEditIcon} label="Edit note" onClick={() => { setVaultContext(null); void handleOpenNote(vaultContext.target.path); }} />
                <VaultContextAction
                  icon={isNotePinned(vaultContext.target.path) ? PinOffIcon : PinIcon}
                  label={isNotePinned(vaultContext.target.path) ? "Unpin note" : "Pin note"}
                  onClick={() => { togglePin(vaultContext.target.path); setVaultContext(null); }}
                />
                <VaultContextDivider />
              </>
            )}

            {vaultContext.target.isDirectory && (
              <>
                <VaultContextAction icon={PlusSignIcon} label="New note here" onClick={() => beginCreate(vaultContext.target.path, "file")} />
                <VaultContextAction icon={Folder01Icon} label="New folder here" onClick={() => beginCreate(vaultContext.target.path, "folder")} />
                {vaultClipboard && (
                  <VaultContextAction
                    icon={ClipboardPasteIcon}
                    label={`Paste ${vaultClipboard.operation === "copy" ? "copy" : "move"} here`}
                    disabled={
                      vaultJoin(vaultContext.target.path, vaultClipboard.target.name) === vaultClipboard.target.path
                      || (vaultClipboard.target.isDirectory && isVaultPathWithin(vaultContext.target.path, vaultClipboard.target.path))
                    }
                    onClick={() => void pasteVaultClipboard(vaultContext.target.path)}
                  />
                )}
                <VaultContextDivider />
              </>
            )}

            {vaultContext.target.kind !== "root" && (
              <>
                <VaultContextAction icon={Edit02Icon} label="Rename…" onClick={() => beginRename(vaultContext.target)} />
                <VaultContextAction icon={Copy01Icon} label="Copy" onClick={() => beginClipboardOperation(vaultContext.target, "copy")} />
                <VaultContextAction icon={Move01Icon} label="Move…" onClick={() => beginClipboardOperation(vaultContext.target, "move")} />
                <VaultContextAction icon={Copy01Icon} label="Copy path" onClick={() => void copyVaultPath(vaultContext.target.path)} />
                <VaultContextDivider />
                <VaultContextAction
                  icon={Delete02Icon}
                  label={vaultContext.target.isDirectory
                    ? "Delete folder…"
                    : vaultContext.target.kind === "note" ? "Delete note…" : "Delete file…"}
                  danger
                  onClick={() => {
                    const target = vaultContext.target;
                    setVaultContext(null);
                    void handleDelete(target.path, target.name);
                  }}
                />
              </>
            )}

            {vaultContext.target.kind === "root" && (
              <VaultContextAction icon={Refresh01Icon} label="Refresh Vault" onClick={() => { setVaultContext(null); void loadTree(); }} />
            )}
          </div>
        </>,
        document.body,
      )}

      {renameTarget && createPortal(
        <div className="sidebar-sheet" onClick={() => setRenameTarget(null)}>
          <div
            className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[0_24px_70px_rgba(0,0,0,0.7)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div data-drag-handle className="flex h-9 shrink-0 cursor-move items-center justify-between border-b border-border px-3">
              <span className="truncate text-xs font-medium">Rename {renameTarget.name}</span>
              <button
                type="button"
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setRenameTarget(null)}
                aria-label="Cancel rename"
              >
                <span className="text-lg leading-none">×</span>
              </button>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-foreground">Name</label>
                <Input
                  value={renameName}
                  onChange={(event) => setRenameName(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void confirmRename();
                    if (event.key === "Escape") setRenameTarget(null);
                  }}
                  className="h-8 text-[11px]"
                  autoFocus
                />
                {!renameTarget.isDirectory && (
                  <span className="font-mono text-[9px] text-muted-foreground">The current note extension is kept unless you enter another one.</span>
                )}
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-[10px]" onClick={() => void confirmRename()}>Rename</Button>
                <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setRenameTarget(null)}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>,
        sheetHost(),
      )}

      {/* Create modal */}
      {showCreate &&
        createPortal(
          <div
            className="sidebar-sheet"
            onClick={() => setShowCreate(false)}
          >
            <div
              className="pointer-events-auto w-full max-w-sm rounded-xl border border-border bg-card text-card-foreground shadow-[0_24px_70px_rgba(0,0,0,0.7)] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div data-drag-handle className="flex h-9 shrink-0 cursor-move items-center justify-between border-b border-border px-3">
                <span className="text-xs font-medium">
                  {createType === "folder" ? "New Folder" : "New Note"}
                </span>
                <button
                  type="button"
                  className="inline-flex size-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
                  onClick={() => setShowCreate(false)}
                >
                  <span className="text-lg leading-none">×</span>
                </button>
              </div>

              <div className="p-4 flex flex-col gap-3">
                <div className="flex rounded-lg border border-border/50 bg-muted/30 p-0.5">
                  {(["file", "folder"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCreateType(t)}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                        createType === t
                          ? "bg-card text-foreground shadow-sm border border-border/50"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t === "file" ? "Note" : "Folder"}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-foreground font-medium">Name</label>
                  <Input
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder={createType === "folder" ? "e.g., Projects" : "e.g., ideas.md"}
                    className="h-8 text-[11px]"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                    }}
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="text-[10px] h-7" onClick={handleCreate}>
                    Create
                  </Button>
                  <Button size="sm" variant="ghost" className="text-[10px] h-7" onClick={() => setShowCreate(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          sheetHost()
        )}

      {/* Template picker modal */}
      {showTemplatePicker &&
        createPortal(
          <div
            className="sidebar-sheet"
            onClick={() => setShowTemplatePicker(false)}
          >
            <div
              className="pointer-events-auto w-full max-w-sm rounded-xl border border-border bg-card text-card-foreground shadow-[0_24px_70px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col max-h-[80vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div data-drag-handle className="flex h-9 shrink-0 cursor-move items-center justify-between border-b border-border px-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">New note from template</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTemplatePicker(false);
                      startNewTemplate();
                    }}
                    className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-white/10 hover:text-white"
                    title="Create custom template"
                  >
                    <HugeiconsIcon icon={PlusSignIcon} size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTemplatePicker(false)}
                    className="inline-flex size-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <span className="text-lg leading-none">×</span>
                  </button>
                </div>
              </div>
              <div className="p-2 flex flex-col gap-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {templates.map((t) => {
                  const isBuiltin = builtinTemplateIds.has(t.id);
                  return (
                    <div
                      key={t.id}
                      className="group flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => handleCreateFromTemplate(t.id)}
                        className="flex flex-1 min-w-0 items-center justify-between text-left"
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="text-[11px] font-medium text-foreground truncate">{t.label}</span>
                          <span className="text-[9px] text-muted-foreground truncate">{t.fileName}</span>
                        </div>
                        <HugeiconsIcon icon={ArrowRight01Icon} size={10} className="text-muted-foreground shrink-0" />
                      </button>
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        {!isBuiltin && (
                          <>
                            <button
                              type="button"
                              onClick={() => startTemplateEdit(t)}
                              className="rounded p-0.5 hover:bg-foreground/10 text-muted-foreground"
                              title="Edit"
                            >
                              <HugeiconsIcon icon={PencilEdit01Icon} size={10} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTemplate(t.id)}
                              className="rounded p-0.5 hover:bg-foreground/10 text-destructive"
                              title="Delete"
                            >
                              <HugeiconsIcon icon={Cancel01Icon} size={10} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setShowTemplatePicker(false);
                    setShowCreate(true);
                  }}
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-muted/50 transition-colors"
                >
                  <span className="text-[11px] text-muted-foreground">Blank note</span>
                  <HugeiconsIcon icon={PlusSignIcon} size={10} className="text-muted-foreground" />
                </button>
              </div>
            </div>
          </div>,
          sheetHost()
        )}

      {/* Template editor modal */}
      {showTemplateEditor &&
        createPortal(
          <div
            className="sidebar-sheet"
            onClick={() => setShowTemplateEditor(false)}
          >
            <div
              className="w-full max-w-lg rounded-xl border border-border bg-card text-card-foreground shadow-[0_24px_70px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col max-h-[80vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div data-drag-handle className="flex h-9 shrink-0 cursor-move items-center justify-between border-b border-border px-3">
                <span className="text-xs font-medium">
                  {editingTemplateId ? "Edit template" : "New template"}
                </span>
                <button
                  type="button"
                  className="inline-flex size-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-white/10 hover:text-white"
                  onClick={() => setShowTemplateEditor(false)}
                >
                  <span className="text-lg leading-none">×</span>
                </button>
              </div>
              <div className="p-4 flex flex-col gap-3 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-foreground font-medium">Label</Label>
                  <Input
                    value={templateLabel}
                    onChange={(e) => setTemplateLabel(e.target.value)}
                    placeholder="e.g., Meeting notes"
                    className="h-8 text-[11px]"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] text-foreground font-medium">File name</Label>
                    <span className="text-[9px] text-muted-foreground">{"Use {{date}}, {{time}}, {{timestamp}}"}</span>
                  </div>
                  <Input
                    value={templateFileName}
                    onChange={(e) => setTemplateFileName(e.target.value)}
                    placeholder="meeting-{{date}}.md"
                    className="h-8 text-[11px]"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] text-foreground font-medium">Contents</Label>
                    <span className="text-[9px] text-muted-foreground">{"Supports {{date}}, {{time}}, {{timestamp}}"}</span>
                  </div>
                  <textarea
                    value={templateContents}
                    onChange={(e) => setTemplateContents(e.target.value)}
                    placeholder="# Title\n\nBody..."
                    className="h-48 rounded-md border border-border/50 bg-muted/30 p-2 text-[11px] font-mono text-foreground outline-none focus:border-border/70 resize-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    spellCheck={false}
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="text-[10px] h-7" onClick={handleSaveTemplate}>
                    {editingTemplateId ? "Update" : "Create"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-[10px] h-7" onClick={() => setShowTemplateEditor(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          sheetHost()
        )}

      {/* Editor modal */}
      {editingFile &&
        createPortal(
          <div
            className="husk-modal-backdrop"
            onClick={() => setEditingFile(null)}
          >
            <div
              className="w-full max-w-2xl h-[80vh] rounded-xl border border-border bg-card text-card-foreground shadow-[0_24px_70px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div data-drag-handle className="flex h-9 shrink-0 cursor-move items-center justify-between border-b border-border px-3">
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={FileEditIcon} size={12} className="text-muted-foreground" />
                  <span className="text-xs font-medium truncate">{editingFile.split("/").pop()}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" className="h-6 text-[10px]" onClick={handleSaveNote}>
                    Save
                  </Button>
                  <button
                    type="button"
                    className="inline-flex size-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-white/10 hover:text-white"
                    onClick={() => setEditingFile(null)}
                  >
                    <span className="text-lg leading-none">×</span>
                  </button>
                </div>
              </div>

              {/* Editor */}
              <div className="flex-1 flex flex-col min-h-0">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="flex-1 resize-none bg-background text-foreground text-[12px] font-mono p-3 outline-none border-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  spellCheck={false}
                  placeholder="Start typing..."
                />
              </div>
            </div>
          </div>,
          document.body
        )}
      {organizeReview && (
        <NoteOrganizeReview
          name={organizeReview.name}
          original={organizeReview.original}
          organized={organizeReview.organized}
          applying={applyingOrganization}
          onApply={() => void applyOrganizedNote()}
          onClose={() => {
            if (!applyingOrganization) setOrganizeReview(null);
          }}
        />
      )}
    </div>
  </TooltipProvider>
  );
}
