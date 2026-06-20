import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Folder01Icon,
  File01Icon,
  ComputerTerminal02Icon,
  Cancel01Icon,
  PlusSignIcon,
  PencilEdit01Icon,
  ViewIcon,
  Copy01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { addBookmark, useBookmarks, removeBookmark, updateBookmark, type Bookmark } from "./store";
import { toast } from "../toast";
import { createPortal } from "react-dom";

export function BookmarksView({
  inline,
  onRunCommand,
  onTypeCommand,
  onOpenFile,
  onOpenDirectory,
}: {
  inline?: boolean;
  onRunCommand?: (cmd: string) => void;
  onTypeCommand?: (cmd: string) => void;
  onOpenFile?: (path: string) => void;
  onOpenDirectory?: (path: string) => void;
}) {
  const bookmarks = useBookmarks();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Bookmark | null>(null);
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<"directory" | "file" | "command">("directory");
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");
  const [command, setCommand] = useState("");

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setLabel("");
    setPath("");
    setCommand("");
    setType("directory");
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

  const filtered = search.trim()
    ? bookmarks.filter(
        (b) =>
          fuzzyMatch(b.label, search) ||
          fuzzyMatch(b.path || "", search) ||
          fuzzyMatch(b.command || "", search)
      )
    : bookmarks;

  const handleAdd = () => {
    if (!label.trim()) return;
    if (type === "command" && !command.trim()) return;
    if ((type === "directory" || type === "file") && !path.trim()) return;

    addBookmark({
      type,
      label: label.trim(),
      path: type !== "command" ? path.trim() : undefined,
      command: type === "command" ? command.trim() : undefined,
    });

    resetForm();
    toast({ title: "Bookmark added", variant: "success" });
  };

  const startEdit = (b: Bookmark) => {
    setEditingId(b.id);
    setType(b.type);
    setLabel(b.label);
    setPath(b.path || "");
    setCommand(b.command || "");
    setShowForm(true);
  };

  const handleUpdate = () => {
    if (!editingId || !label.trim()) return;
    if (type === "command" && !command.trim()) return;
    if ((type === "directory" || type === "file") && !path.trim()) return;

    updateBookmark(editingId, {
      type,
      label: label.trim(),
      path: type !== "command" ? path.trim() : undefined,
      command: type === "command" ? command.trim() : undefined,
    });

    resetForm();
    toast({ title: "Bookmark updated", variant: "success" });
  };

  const handleRun = (b: Bookmark) => {
    if (b.type === "command" && b.command && onTypeCommand) {
      onTypeCommand(b.command); // type only, don't run
    } else if (b.type === "command" && b.command && onRunCommand) {
      onRunCommand(b.command); // fallback for old callers
    } else if (b.type === "file" && b.path && onOpenFile) {
      onOpenFile(b.path);
    } else if (b.type === "directory" && b.path && onOpenDirectory) {
      onOpenDirectory(b.path);
    }
  };

  const getIcon = (b: Bookmark) => {
    switch (b.type) {
      case "directory":
        return Folder01Icon;
      case "file":
        return File01Icon;
      case "command":
        return ComputerTerminal02Icon;
    }
  };

  return (
    <div className={cn("flex flex-col h-full", inline ? "p-2" : "p-4")}>
      {/* Header row: title + search icon + add icon, all inline */}
      <div className="flex items-center gap-1 mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex-1 truncate">
          Bookmarks
        </h3>
        {bookmarks.length > 0 && (
          <button
            type="button"
            onClick={() => setSearchActive(true)}
            className={cn(
              "inline-flex size-6 items-center justify-center rounded-md border border-border/40 bg-muted/30 text-muted-foreground hover:text-foreground transition-colors",
              searchActive && "border-border/70 text-foreground"
            )}
            title="Filter bookmarks"
          >
            <HugeiconsIcon icon={Search01Icon} size={10} />
          </button>
        )}
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex size-6 items-center justify-center rounded-md border border-border/40 bg-muted/30 text-muted-foreground hover:text-foreground transition-colors"
            title="Add bookmark"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={10} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Search input — inline, replaces the icon when active */}
      {searchActive && bookmarks.length > 0 && (
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
            className="w-full h-6 rounded-md border border-border/40 bg-muted/30 pl-5 pr-6 text-[10px] text-foreground outline-none focus:border-border/70"
            autoFocus
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setSearchActive(false);
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={8} />
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 && !showForm && (
        <p className="text-muted-foreground text-[11px] text-center py-4">
          {search ? "No matches." : "No bookmarks. Click + to add."}
        </p>
      )}

      <div className="flex flex-col gap-1 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {filtered.map((b) => (
          <div
            key={b.id}
            className="group flex items-center gap-1.5 rounded-md border border-border/20 bg-card/20 px-1.5 py-1 transition-colors hover:border-border/40 cursor-pointer"
            onClick={() => handleRun(b)}
            title={b.path || b.command}
          >
            <HugeiconsIcon
              icon={getIcon(b)}
              size={12}
              className="text-muted-foreground shrink-0"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[11px] font-medium text-foreground">
                {b.label}
              </span>
              <span className="truncate text-[9px] text-muted-foreground">
                {b.path || b.command}
              </span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setViewing(b);
              }}
              className="rounded p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 group-hover:opacity-60 hover:!opacity-100"
              title="View"
            >
              <HugeiconsIcon icon={ViewIcon} size={9} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                startEdit(b);
              }}
              className="rounded p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 group-hover:opacity-60 hover:!opacity-100"
              title="Edit"
            >
              <HugeiconsIcon icon={PencilEdit01Icon} size={9} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeBookmark(b.id);
              }}
              className="rounded p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 group-hover:opacity-60 hover:!opacity-100"
              title="Delete"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={9} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>

      {showForm &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
            onClick={() => resetForm()}
          >
            <div
              className="w-full max-w-sm rounded-xl border border-border bg-card text-card-foreground shadow-[0_24px_70px_rgba(0,0,0,0.7)] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
                <span className="text-xs font-medium">
                  {editingId ? "Edit Bookmark" : "New Bookmark"}
                </span>
                <button
                  type="button"
                  className="inline-flex size-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
                  onClick={() => resetForm()}
                  aria-label="Close"
                >
                  <span className="text-lg leading-none">×</span>
                </button>
              </div>

              {/* Body */}
              <div className="p-4 flex flex-col gap-3">
                {/* Type selector — segmented buttons for visibility */}
                <div className="flex rounded-lg border border-border/50 bg-muted/30 p-0.5">
                  {(["directory", "file", "command"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={cn(
                        "flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all",
                        type === t
                          ? "bg-card text-foreground shadow-sm border border-border/50"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {t === "directory" && "Directory"}
                      {t === "file" && "File"}
                      {t === "command" && "Command"}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-foreground font-medium">Label</Label>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g., Project Root"
                    className="h-8 text-[11px]"
                  />
                </div>

                {type !== "command" ? (
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] text-foreground font-medium">Path</Label>
                    <Input
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder={type === "directory" ? "/Users/akikp/huskv2" : "/Users/akikp/huskv2/README.md"}
                      className="h-8 text-[11px]"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px] text-foreground font-medium">Command</Label>
                    <Input
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="pnpm tauri dev"
                      className="h-8 text-[11px]"
                    />
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    className="text-[10px] h-7"
                    onClick={editingId ? handleUpdate : handleAdd}
                  >
                    {editingId ? "Update" : "Add"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[10px] h-7"
                    onClick={resetForm}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* View popup — compact card via portal, matches Modal style */}
      {viewing &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
            onClick={() => setViewing(null)}
          >
            <div
              className="w-full max-w-xs rounded-xl border border-border bg-card text-card-foreground shadow-[0_24px_70px_rgba(0,0,0,0.7)] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon
                    icon={getIcon(viewing)}
                    size={12}
                    className="text-muted-foreground"
                  />
                  <span className="text-xs font-medium">{viewing.label}</span>
                </div>
                <button
                  type="button"
                  className="inline-flex size-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
                  onClick={() => setViewing(null)}
                  aria-label="Close"
                >
                  <span className="text-lg leading-none">×</span>
                </button>
              </div>

              {/* Body */}
              <div className="p-4 flex flex-col gap-3">
                <div className="rounded-md bg-muted/40 border border-border/30 p-2">
                  <code className="text-[10px] font-mono break-all text-foreground">
                    {viewing.path || viewing.command}
                  </code>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition"
                    onClick={() => {
                      const text = viewing.path || viewing.command || "";
                      navigator.clipboard.writeText(text);
                      toast({ title: "Copied", variant: "success" });
                    }}
                  >
                    <HugeiconsIcon icon={Copy01Icon} size={9} />
                    Copy
                  </button>
                  {viewing.type === "command" && onTypeCommand && (
                    <button
                      type="button"
                      className="inline-flex items-center text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition"
                      onClick={() => {
                        onTypeCommand(viewing.command || "");
                        setViewing(null);
                      }}
                    >
                      Type
                    </button>
                  )}
                  {viewing.type === "directory" && onOpenDirectory && (
                    <button
                      type="button"
                      className="inline-flex items-center text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition"
                      onClick={() => {
                        onOpenDirectory(viewing.path || "");
                        setViewing(null);
                      }}
                    >
                      cd
                    </button>
                  )}
                  {viewing.type === "file" && onOpenFile && (
                    <button
                      type="button"
                      className="inline-flex items-center text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition"
                      onClick={() => {
                        onOpenFile(viewing.path || "");
                        setViewing(null);
                      }}
                    >
                      Open
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
