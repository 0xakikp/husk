import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={StarIcon} size={16} />
            Bookmarks
          </DialogTitle>
        </DialogHeader>

        {bookmarks.length === 0 && !showAdd && (
          <p className="text-muted-foreground text-sm text-center py-4">
            No bookmarks yet. Add directories, files, or commands for quick access.
          </p>
        )}

        <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
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
        </div>

        {showAdd && (
          <div className="flex flex-col gap-2 border-t border-border/50 pt-3">
            <Select value={type} onValueChange={(v) => setType(v as Bookmark["type"])}>
              <SelectTrigger className="h-8 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="directory">Directory</SelectItem>
                <SelectItem value="file">File</SelectItem>
                <SelectItem value="command">Command</SelectItem>
              </SelectContent>
            </Select>

            <div>
              <Label className="text-[11px]">Label</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g., Project Root"
                className="h-8 text-[12px]"
              />
            </div>

            {type !== "command" ? (
              <div>
                <Label className="text-[11px]">Path</Label>
                <Input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={type === "directory" ? "/Users/akikp/huskv2" : "/Users/akikp/huskv2/README.md"}
                  className="h-8 text-[12px]"
                />
              </div>
            ) : (
              <div>
                <Label className="text-[11px]">Command</Label>
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="pnpm tauri dev"
                  className="h-8 text-[12px]"
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" className="text-[11px] h-7" onClick={handleAdd}>
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-[11px] h-7"
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!showAdd && (
          <Button
            size="sm"
            variant="outline"
            className="text-[11px] h-7 w-full"
            onClick={() => setShowAdd(true)}
          >
            <HugeiconsIcon icon={StarIcon} size={12} className="mr-1" />
            Add Bookmark
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
