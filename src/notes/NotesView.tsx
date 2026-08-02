import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
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
} from "@hugeicons/core-free-icons";
import { fileIconUrl, folderIconUrl } from "../explorer/iconResolver";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  loadNotesTree,
  readNote,
  writeNote,
  createNote,
  createNoteFolder,
  deleteNote,
  ensureNotesDirectory,
  isNoteFile,
  getLastViewedNote,
  setLastViewedNote,
  pinNote,
  unpinNote,
  isNotePinned,
  touchRecentNote,
  removeRecentNote,
  getPinnedNotes,
  getRecentNotes,
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
} from "./store";
import { toast } from "../toast";
import { createPortal } from "react-dom";
import { sheetHost } from "../components/sheetHost";

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
  const [recents, setRecents] = useState<string[]>([]);

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
    setRecents(getRecentNotes());
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

  // Full-text search effect
  useEffect(() => {
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
  }, [search]);

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

  const handleOpenNote = async (path: string) => {
    setLastViewedNote(path);
    touchRecentNote(path);
    loadLists();
    if (onOpenFile) {
      const name = path.split("/").pop() || path;
      onOpenFile(path, name);
    } else {
      // Fallback: read and show in a simple modal if no editor available
      const content = await readNote(path);
      setEditingFile(path);
      setEditContent(content);
    }
  };

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
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteNote(path);
      unpinNote(path);
      removeRecentNote(path);
      loadLists();
      await loadTree();
      if (editingFile === path) {
        setEditingFile(null);
        setEditContent("");
      }
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
    const paths: string[] = [];
    function walk(nodes: FileNode[]) {
      for (const n of nodes) {
        if (n.isDirectory && n.children) walk(n.children);
        else if (!n.isDirectory && isNoteFile(n.name)) paths.push(n.path);
      }
    }
    walk(tree);
    return paths;
  }, [tree]);

  const pinnedInfo = useMemo(() => {
    return pinned
      .filter((p) => allNotePaths.includes(p))
      .map((p) => ({ path: p, name: p.split("/").pop() || p }));
  }, [pinned, allNotePaths]);

  const recentsInfo = useMemo(() => {
    return recents
      .filter((r) => allNotePaths.includes(r) && !pinned.includes(r))
      .map((r) => ({ path: r, name: r.split("/").pop() || r }))
      .slice(0, 5);
  }, [recents, allNotePaths, pinned]);

  const renderNode = (node: FileNode, depth: number) => {
    const isExpanded = expanded.has(node.path) || node.expanded;
    /* Mirror the file explorer's row recipe: same .enode/.edir/.efile classes,
       same ▾/▸ caret column, same 6 + depth*12 indent — so the notes tree
       reads exactly like the Files section. */
    const indent = { paddingLeft: 6 + depth * 12 };

    return (
      <div key={node.path}>
        <div className="group relative">
          {node.isDirectory ? (
            <button
              type="button"
              className="enode edir"
              style={indent}
              onClick={() => toggleExpanded(node.path)}
            >
              <span className="enode-caret">{isExpanded ? "▾" : "▸"}</span>
              <img src={folderIconUrl(node.name, !!isExpanded)} className="enode-img" alt="" draggable={false} />
              <span className="truncate">{node.name}</span>
            </button>
          ) : (
            <button
              type="button"
              className={cn("enode efile", editingFile === node.path && "active")}
              style={indent}
              onClick={() => {
                if (isNoteFile(node.name)) handleOpenNote(node.path);
              }}
              title={isNoteFile(node.name) ? "Open in editor" : node.name}
            >
              <span className="enode-caret" />
              <img src={fileIconUrl(node.name)} className="enode-img" alt="" draggable={false} />
              <span className="truncate">{node.name}</span>
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

  const renderQuickNote = (item: { path: string; name: string }) => (
    <div
      key={item.path}
      className="group flex items-center gap-1.5 rounded-md border border-border/20 bg-card/20 px-1.5 py-1 hover:border-border/40 cursor-pointer"
      onClick={() => handleOpenNote(item.path)}
    >
      <img src={fileIconUrl(item.name)} alt="" className="size-3.5 object-contain shrink-0" draggable={false} />
      <span className="flex-1 min-w-0 truncate text-[11px] text-foreground">{item.name}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          togglePin(item.path);
        }}
        className="rounded p-0.5 text-primary opacity-0 transition-opacity group-hover:opacity-100"
        title="Unpin"
      >
        <HugeiconsIcon icon={PinOffIcon} size={8} />
      </button>
    </div>
  );

  const searchIsActive = searchActive && search.trim().length > 0;
  const builtinTemplateIds = useMemo(() => new Set(["builtin-daily", "builtin-incident", "builtin-todo"]), []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("flex flex-col h-full", inline ? "p-2" : "p-4")}>
        {/* Header */}
        <div className="flex items-center gap-1 mb-2">
          <div className="flex items-center gap-1.5 flex-1">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate">
              Notes
            </h3>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="What is this?"
                >
                  <HugeiconsIcon icon={InformationCircleIcon} size={12} strokeWidth={1.75} />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={6}
                className="max-w-[220px] border border-border/60 bg-zinc-950 text-zinc-100 text-[10.5px] p-2 shadow-lg"
              >
                Markdown notes tied to the workspace. Pin important notes, search content, and create new notes from templates.
              </TooltipContent>
            </Tooltip>
          </div>
          <button
            type="button"
            onClick={() => setShowTemplatePicker(true)}
            className="inline-flex size-6 items-center justify-center rounded-md border border-border/40 bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
            title="New note from template"
          >
            <HugeiconsIcon icon={File02Icon} size={10} />
          </button>
          {tree.length > 0 && (
            <button
              type="button"
              onClick={() => setSearchActive(true)}
              className={cn(
                "inline-flex size-6 items-center justify-center rounded-md border border-border/40 bg-muted/30 text-muted-foreground hover:text-foreground transition-colors",
                searchActive && "border-border/70 text-foreground"
              )}
              title="Search notes"
            >
              <HugeiconsIcon icon={Search01Icon} size={10} />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setCreateType("file");
              setCreateDir(notesDirRef.current);
              setShowCreate(true);
            }}
            className="inline-flex size-6 items-center justify-center rounded-md border border-border/40 bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
            title="New note"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={10} strokeWidth={2} />
          </button>
        </div>

      {/* Search */}
      {searchActive && (
        <div className="relative mb-2">
          <HugeiconsIcon
            icon={Search01Icon}
            size={9}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => {
              if (!search) setSearchActive(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearch("");
                setSearchActive(false);
              }
            }}
            placeholder="Search names & content…"
            className="w-full h-6 rounded-md border border-border/40 bg-muted/30 pl-5 pr-1.5 text-[10px] text-foreground outline-none focus:border-border/70"
            autoFocus
          />
        </div>
      )}

      {/* Pinned & Recents */}
      {!searchIsActive && !loading && (
        <div className="flex flex-col gap-2 mb-2 pl-1.5">
          {pinnedInfo.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground/80 font-semibold">
                <HugeiconsIcon icon={PinIcon} size={8} />
                Pinned
              </div>
              <div className="flex flex-col gap-1">{pinnedInfo.map(renderQuickNote)}</div>
            </div>
          )}
          {recentsInfo.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-amber-600/90 dark:text-amber-400/90 font-semibold">
                <HugeiconsIcon icon={Clock01Icon} size={8} />
                Recent
              </div>
              <div className="flex flex-col gap-0.5 border-l-2 border-amber-400/60 pl-1.5">
                {recentsInfo.map((item) => (
                  <div
                    key={item.path}
                    className="group flex items-center gap-1.5 rounded-sm bg-transparent px-1 py-1 cursor-pointer transition-colors hover:bg-amber-400/[0.07]"
                    onClick={() => handleOpenNote(item.path)}
                  >
                    <img src={fileIconUrl(item.name)} alt="" className="size-3.5 object-contain shrink-0" draggable={false} />
                    <span className="flex-1 min-w-0 truncate text-[11px] text-foreground/90 transition-colors group-hover:text-amber-300">{item.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        pinNote(item.path);
                        loadLists();
                      }}
                      className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                      title="Pin note"
                    >
                      <HugeiconsIcon icon={PinIcon} size={8} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tree / Search results */}
      <div className="flex-1 overflow-y-auto pl-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading || searching ? (
          <div className="py-4 text-center text-[11px] text-muted-foreground">{searching ? "Searching…" : "Loading…"}</div>
        ) : searchIsActive ? (
          searchResults.length === 0 ? (
            <div className="py-4 text-center text-[11px] text-muted-foreground">No matches.</div>
          ) : (
            <div className="flex flex-col gap-1">
              {searchResults.map((r) => (
                <div
                  key={r.path}
                  className="group flex flex-col gap-0.5 rounded-md border border-border/20 bg-card/20 px-1.5 py-1.5 hover:border-border/40 cursor-pointer"
                  onClick={() => handleOpenNote(r.path)}
                >
                  <div className="flex items-center gap-1.5">
                    <img src={fileIconUrl(r.name)} alt="" className="size-3.5 object-contain shrink-0" draggable={false} />
                    <span className="flex-1 min-w-0 truncate text-[11px] font-medium text-foreground">{r.name}</span>
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
          filteredTree.map((node) => renderNode(node, 0))
        )}
      </div>

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
    </div>
  </TooltipProvider>
  );
}
