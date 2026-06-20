import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  PlusSignIcon,
  Delete02Icon,
  Search01Icon,
  FileEditIcon,
  File01Icon,
} from "@hugeicons/core-free-icons";
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
  type FileNode,
} from "./store";
import { toast } from "../toast";
import { createPortal } from "react-dom";

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
  const [loading, setLoading] = useState(true);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showCreate, setShowCreate] = useState(false);

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
    
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

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

  const handleDelete = async (path: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteNote(path);
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

  const filteredTree = search.trim() ? filterTree(tree, search) : tree;

  const renderNode = (node: FileNode, depth: number) => {
    const isExpanded = expanded.has(node.path) || node.expanded;
    const paddingLeft = depth * 12 + 4;

    return (
      <div key={node.path}>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-md py-1 pr-1 transition-colors hover:bg-muted/30",
            editingFile === node.path && "bg-muted/40"
          )}
          style={{ paddingLeft: `${paddingLeft}px` }}
        >
          {node.isDirectory ? (
            <button
              type="button"
              onClick={() => toggleExpanded(node.path)}
              className="inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={10}
                className={cn("transition-transform", !isExpanded && "-rotate-90")}
              />
            </button>
          ) : (
            <span className="inline-flex size-4 items-center justify-center">
              <HugeiconsIcon
                icon={File01Icon}
                size={10}
                className="text-muted-foreground"
              />
            </span>
          )}

          <button
            type="button"
            onClick={() => {
              if (node.isDirectory) {
                toggleExpanded(node.path);
              } else if (isNoteFile(node.name)) {
                handleOpenNote(node.path);
              }
            }}
            className={cn(
              "flex min-w-0 flex-1 text-left text-[11px]",
              node.isDirectory
                ? "font-medium text-foreground"
                : isNoteFile(node.name)
                  ? "text-foreground hover:text-primary"
                  : "text-muted-foreground"
            )}
          >
            <span className="truncate">{node.name}</span>
          </button>

          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            {node.isDirectory && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setCreateType("file");
                  setCreateDir(node.path);
                  setShowCreate(true);
                }}
                className="rounded p-0.5 hover:bg-foreground/10"
                title="New note"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={9} />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(node.path, node.name);
              }}
              className="rounded p-0.5 hover:bg-foreground/10 text-destructive"
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

  return (
    <div className={cn("flex flex-col h-full", inline ? "p-2" : "p-4")}>
      {/* Header */}
      <div className="flex items-center gap-1 mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1 truncate">
          Notes
        </h3>
        {tree.length > 0 && (
          <button
            type="button"
            onClick={() => setSearchActive(true)}
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-md border border-border/40 bg-muted/30 text-muted-foreground hover:text-foreground transition-colors",
              searchActive && "border-border/70 text-foreground"
            )}
            title="Filter notes"
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
            placeholder=""
            className="w-full h-6 rounded-md border border-border/40 bg-muted/30 pl-5 pr-1.5 text-[10px] text-foreground outline-none focus:border-border/70"
            autoFocus
          />
        </div>
      )}

      {/* Tree */}
      <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading ? (
          <div className="py-4 text-center text-[11px] text-muted-foreground">Loading...</div>
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
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
            onClick={() => setShowCreate(false)}
          >
            <div
              className="w-full max-w-sm rounded-xl border border-border bg-card text-card-foreground shadow-[0_24px_70px_rgba(0,0,0,0.7)] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
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
          document.body
        )}

      {/* Editor modal */}
      {editingFile &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
            onClick={() => setEditingFile(null)}
          >
            <div
              className="w-full max-w-2xl h-[80vh] rounded-xl border border-border bg-card text-card-foreground shadow-[0_24px_70px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
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
  );
}
