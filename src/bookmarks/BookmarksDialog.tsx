import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { CompactForm, CompactButton, CompactInput, CompactLabel, CompactSelectTrigger, CompactSelectContent, CompactSelectItem } from "../components/compact-form";
import { PanelHeader } from "../shell/PanelHeader";
import {
  Select,
  SelectValue,
} from "@/components/ui/select";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Folder01Icon,
  File01Icon,
  ComputerTerminal02Icon,
  Cancel01Icon,
  StarIcon,
} from "@hugeicons/core-free-icons";
import { addBookmark, useBookmarks, removeBookmark, type Bookmark } from "./store";
import { toast } from "../toast";

export function BookmarksDialog({
  open,
  onClose,
  onRunCommand,
  onOpenFile,
  onOpenDirectory,
}: {
  open: boolean;
  onClose: () => void;
  onRunCommand?: (cmd: string) => void;
  onOpenFile?: (path: string) => void;
  onOpenDirectory?: (path: string) => void;
}) {
  const bookmarks = useBookmarks();
  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState<"directory" | "file" | "command">("directory");
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");
  const [command, setCommand] = useState("");

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

    setShowAdd(false);
    setLabel("");
    setPath("");
    setCommand("");
    toast({ title: "Bookmark added", variant: "success" });
  };

  const handleRun = (b: Bookmark) => {
    if (b.type === "command" && b.command && onRunCommand) {
      onRunCommand(b.command);
      onClose();
    } else if (b.type === "file" && b.path && onOpenFile) {
      onOpenFile(b.path);
      onClose();
    } else if (b.type === "directory" && b.path && onOpenDirectory) {
      onOpenDirectory(b.path);
      onClose();
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
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="compact-panel compact-dialog flex max-h-[calc(100dvh-48px)] max-w-md flex-col gap-0 overflow-hidden p-0" showCloseButton={false} aria-describedby={undefined}>
        <PanelHeader icon={StarIcon} title={<DialogTitle className="compact-title">Bookmarks</DialogTitle>}
          actions={<DialogClose asChild><CompactButton icon variant="ghost" aria-label="Close bookmarks">×</CompactButton></DialogClose>} />
        <div className="compact-body flex flex-col gap-3">
        {bookmarks.length === 0 && !showAdd && (
          <p className="compact-help py-3 text-center">
            No bookmarks yet. Add directories, files, or commands for quick access.
          </p>
        )}

        {bookmarks.length > 0 && <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
          {bookmarks.map((b) => (
            <div
              key={b.id}
              className="group flex items-center gap-2 rounded-md border border-border/20 bg-card/20 px-2 py-1.5 transition-colors hover:border-border/40 cursor-pointer"
              onClick={() => handleRun(b)}
            >
              <HugeiconsIcon icon={getIcon(b)} size={14} className="text-muted-foreground shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[11.5px] font-medium text-foreground">
                  {b.label}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {b.path || b.command}
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeBookmark(b.id);
                }}
                className="rounded p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 group-hover:opacity-60 hover:!opacity-100"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>}

        {showAdd && (
          <CompactForm className={bookmarks.length > 0 ? "border-t border-border pt-3" : undefined} aria-label="Add bookmark">
            <div className="compact-field"><CompactLabel htmlFor="bookmark-type">Type</CompactLabel>
            <Select value={type} onValueChange={(v) => setType(v as Bookmark["type"])}>
              <CompactSelectTrigger id="bookmark-type">
                <SelectValue />
              </CompactSelectTrigger>
              <CompactSelectContent>
                <CompactSelectItem value="directory">Directory</CompactSelectItem>
                <CompactSelectItem value="file">File</CompactSelectItem>
                <CompactSelectItem value="command">Command</CompactSelectItem>
              </CompactSelectContent>
            </Select></div>

            <div className="compact-field">
              <CompactLabel htmlFor="bookmark-label">Label</CompactLabel>
              <CompactInput id="bookmark-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g., Project Root"
              />
            </div>

            {type !== "command" ? (
              <div className="compact-field">
                <CompactLabel htmlFor="bookmark-path">Path</CompactLabel>
                <CompactInput id="bookmark-path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={type === "directory" ? "/path/to/project" : "/path/to/project/README.md"}
                />
              </div>
            ) : (
              <div className="compact-field">
                <CompactLabel htmlFor="bookmark-command">Command</CompactLabel>
                <CompactInput id="bookmark-command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="pnpm tauri dev"
                />
              </div>
            )}

            <div className="compact-actions">
              <div className="compact-actions-main">
              <CompactButton
                variant="ghost"
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </CompactButton>
              <CompactButton variant="primary" onClick={handleAdd}>Add</CompactButton>
              </div>
            </div>
          </CompactForm>
        )}

        {!showAdd && (
          <CompactButton
            className="w-full"
            onClick={() => setShowAdd(true)}
          >
            <HugeiconsIcon icon={StarIcon} size={12} className="mr-1" />
            Add Bookmark
          </CompactButton>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
