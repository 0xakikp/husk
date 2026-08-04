import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileEditIcon, CodeIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { NotesView } from "../notes/NotesView";
import { ScriptsView } from "../scripts/ScriptsView";

/**
 * The Vault: things you keep, as opposed to things you are working on.
 *
 * This replaces the Notes/Bookmarks pair. Bookmarks stored three unrelated
 * things — directories, files and commands — and every one of them was already
 * reachable faster elsewhere: files through the launcher's `f:` scope, commands
 * through shell history and Workflows, directories through `cd` and history.
 * The store and its `b:` launcher scope are untouched, so nothing saved is lost;
 * it simply no longer needs a panel of its own.
 *
 * Scripts takes the slot because it is the one job none of those cover: a file
 * on disk that you want to run, with arguments, without leaving the terminal.
 */
type Tab = "notes" | "scripts";

const TABS: { id: Tab; label: string; icon: typeof FileEditIcon }[] = [
  { id: "notes", label: "Notes", icon: FileEditIcon },
  { id: "scripts", label: "Scripts", icon: CodeIcon },
];

export function VaultView({
  inline,
  onOpenFile,
  onTypeCommand,
  onRunCommand,
}: {
  inline?: boolean;
  onOpenFile: (path: string, name: string) => void;
  onTypeCommand: (cmd: string) => void;
  onRunCommand: (cmd: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("notes");

  return (
    <div className={cn("flex h-full min-h-0 flex-col", inline ? "p-2" : "p-4")}>
      <div className="mb-2 flex shrink-0 rounded-lg border border-border/50 bg-muted/30 p-0.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all",
              tab === t.id
                ? "border border-border/50 bg-card shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            style={tab === t.id ? { color: "var(--accent)" } : undefined}
          >
            <HugeiconsIcon icon={t.icon} size={10} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === "notes" ? (
          <NotesView inline={inline} onOpenFile={onOpenFile} />
        ) : (
          <ScriptsView
            onTypeCommand={onTypeCommand}
            onRunCommand={onRunCommand}
            onOpenFile={onOpenFile}
          />
        )}
      </div>
    </div>
  );
}
