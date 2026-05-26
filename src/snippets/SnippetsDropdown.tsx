import { useEffect, useState } from "react";
import { loadSnippets, saveSnippets, newSnippetId, type Snippet } from "./store";
import { runInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SourceCodeIcon,
  PlayIcon,
  Copy01Icon,
  PencilEdit02Icon,
  Delete02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";

/** Snippets as a toolbar dropdown (husk v1 style): list with insert/copy/edit/
 *  delete, plus an inline new/edit form. */
export function SnippetsDropdown() {
  const [open, setOpen] = useState(false);
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets());
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => saveSnippets(snippets), [snippets]);

  const startNew = () => {
    setEditing(null);
    setName("");
    setContent("");
    setFormOpen(true);
  };
  const startEdit = (s: Snippet) => {
    setEditing(s);
    setName(s.name);
    setContent(s.content);
    setFormOpen(true);
  };
  const save = () => {
    if (!name.trim() || !content.trim()) return;
    if (editing) {
      setSnippets((p) => p.map((s) => (s.id === editing.id ? { ...s, name: name.trim(), content } : s)));
    } else {
      setSnippets((p) => [...p, { id: newSnippetId(), name: name.trim(), content }]);
    }
    setFormOpen(false);
  };
  const insert = (s: Snippet) => {
    if (runInActiveTerminal(s.content)) {
      toast({ title: `Inserted: ${s.name}`, variant: "success" });
      setOpen(false);
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };
  const copy = (s: Snippet) => {
    void navigator.clipboard.writeText(s.content);
    toast({ title: "Copied to clipboard", variant: "info" });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Snippets"
          title="Snippets"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon icon={SourceCodeIcon} size={16} strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex h-9 items-center justify-between border-b border-border/60 px-3">
          <span className="text-xs font-medium text-foreground">Snippets</span>
          {!formOpen ? (
            <button
              type="button"
              title="New snippet"
              onClick={startNew}
              className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
            </button>
          ) : null}
        </div>
        <div className="max-h-80 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {formOpen ? (
            <div className="flex flex-col gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Restart API"
                className="h-8 bg-background text-[12px]"
              />
              <Textarea
                value={content}
                rows={4}
                onChange={(e) => setContent(e.target.value)}
                placeholder="kubectl rollout restart deployment/api"
                className="bg-background text-[12px]"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={save}>
                  Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : snippets.length === 0 ? (
            <p className="px-1 py-5 text-center text-[11.5px] leading-relaxed text-muted-foreground">
              No snippets yet. Save commands you reuse and insert them into the terminal.
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {snippets.map((s) => (
                <div key={s.id} className="group/snip flex items-center gap-2 rounded px-1.5 py-1.5 hover:bg-muted">
                  <button
                    type="button"
                    title="Insert into terminal"
                    onClick={() => insert(s)}
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded text-primary hover:bg-primary/10"
                  >
                    <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] text-foreground">{s.name}</div>
                    <div className="truncate font-mono text-[10.5px] text-muted-foreground">{s.content}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/snip:opacity-100">
                    <SnipAction icon={Copy01Icon} label="Copy" onClick={() => copy(s)} />
                    <SnipAction icon={PencilEdit02Icon} label="Edit" onClick={() => startEdit(s)} />
                    <SnipAction
                      icon={Delete02Icon}
                      label="Delete"
                      onClick={() => setSnippets((p) => p.filter((x) => x.id !== s.id))}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SnipAction({
  icon,
  label,
  onClick,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <HugeiconsIcon icon={icon} size={12} strokeWidth={1.75} />
    </button>
  );
}
