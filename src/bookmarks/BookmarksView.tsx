import { useState } from "react";
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
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Bookmarks
        </h3>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded p-0.5 hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Add bookmark"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={2} />
          </button>
        )}
      </div>

      {bookmarks.length === 0 && !showForm && (
        <p className="text-muted-foreground text-[11px] text-center py-4">
          No bookmarks. Click + to add directories, files, or commands.
        </p>
      )}

      <div className="flex flex-col gap-1 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {bookmarks.map((b) => (
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

      {showForm && (
        <div className="flex flex-col gap-2 border-t border-border/50 pt-2 mt-2">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {editingId ? "Edit Bookmark" : "New Bookmark"}
          </h4>
          <Select value={type} onValueChange={(v) => setType(v as Bookmark["type"])}>
            <SelectTrigger className="h-7 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="directory">Directory</SelectItem>
              <SelectItem value="file">File</SelectItem>
              <SelectItem value="command">Command</SelectItem>
            </SelectContent>
          </Select>

          <div>
            <Label className="text-[10px]">Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., Project Root"
              className="h-7 text-[11px]"
            />
          </div>

          {type !== "command" ? (
            <div>
              <Label className="text-[10px]">Path</Label>
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={type === "directory" ? "/Users/akikp/huskv2" : "/Users/akikp/huskv2/README.md"}
                className="h-7 text-[11px]"
              />
            </div>
          ) : (
            <div>
              <Label className="text-[10px]">Command</Label>
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="pnpm tauri dev"
                className="h-7 text-[11px]"
              />
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              className="text-[10px] h-6"
              onClick={editingId ? handleUpdate : handleAdd}
            >
              {editingId ? "Update" : "Add"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-[10px] h-6"
              onClick={resetForm}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* View popup — compact card via portal */}
      {viewing &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setViewing(null)}
          >
            <div
              className="w-full max-w-xs rounded-lg border border-border/50 bg-card/95 p-3 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <HugeiconsIcon
                  icon={getIcon(viewing)}
                  size={12}
                  className="text-muted-foreground"
                />
                <h4 className="text-xs font-semibold">{viewing.label}</h4>
              </div>

              <div className="rounded bg-muted/40 border border-border/30 p-1.5 mb-2">
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
                <button
                  type="button"
                  className="inline-flex items-center text-[10px] px-2 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/5 transition ml-auto"
                  onClick={() => setViewing(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
