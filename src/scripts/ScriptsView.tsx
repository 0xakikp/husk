import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlayIcon,
  FileEditIcon,
  Copy01Icon,
  Search01Icon,
  FolderOpenIcon,
} from "@hugeicons/core-free-icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { usePrefs, setPrefs } from "../settings/preferences";
import { listScripts, runCommandFor, type ScriptFile } from "./scripts";
import { toast } from "../toast";

/**
 * Scripts — a folder of runnable files, listed for one-keystroke use.
 *
 * Clicking a row *types* the command into the terminal rather than running it.
 * Scripts almost always take arguments, and typing leaves the cursor ready to
 * add them; it also means nothing executes because you mis-clicked. The ▶ button
 * is there for the times you do want it to just go.
 */
export function ScriptsView({
  onTypeCommand,
  onRunCommand,
  onOpenFile,
}: {
  onTypeCommand: (cmd: string) => void;
  onRunCommand: (cmd: string) => void;
  onOpenFile: (path: string, name: string) => void;
}) {
  const dir = usePrefs().scriptsDir;
  const [files, setFiles] = useState<ScriptFile[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!dir) {
      setFiles([]);
      return;
    }
    setLoading(true);
    void listScripts(dir).then((f) => {
      setFiles(f);
      setLoading(false);
    });
  }, [dir]);

  useEffect(reload, [reload]);

  const pickDir = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected && typeof selected === "string") setPrefs({ scriptsDir: selected });
  }, []);

  const shown = query.trim()
    ? files.filter((f) => f.name.toLowerCase().includes(query.trim().toLowerCase()))
    : files;

  if (!dir) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
        <HugeiconsIcon icon={FolderOpenIcon} size={26} strokeWidth={1.5} className="opacity-30" />
        <p className="text-[11px] font-medium text-foreground">No scripts folder</p>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Point Husk at a folder of shell, Python or Node scripts to run them from here.
        </p>
        <button
          type="button"
          onClick={pickDir}
          className="mt-1 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[10.5px] text-foreground transition-colors hover:bg-muted/60"
        >
          Pick folder
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex items-center gap-1 rounded-md border border-border/40 bg-muted/20 px-1.5">
        <HugeiconsIcon icon={Search01Icon} size={11} className="shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter scripts…"
          className="h-6 min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/60"
        />
        <button
          type="button"
          onClick={pickDir}
          title={dir}
          className="shrink-0 rounded px-1 text-[9.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          folder
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="px-1 py-3 text-center text-[10.5px] text-muted-foreground">
          {loading ? "Reading folder…" : files.length === 0 ? "No scripts in this folder." : "No match."}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {shown.map((f) => (
            <div
              key={f.path}
              className="group flex items-center gap-1.5 rounded-md border border-border/20 bg-card/20 px-1.5 py-1 transition-colors hover:border-border/40"
            >
              <button
                type="button"
                onClick={() => onTypeCommand(runCommandFor(f.path))}
                title={`Type: ${runCommandFor(f.path)}`}
                className="flex min-w-0 flex-1 flex-col items-start text-left"
              >
                <span className="w-full truncate text-[11px] font-medium text-foreground">{f.name}</span>
                <span className="text-[9px] text-muted-foreground">{f.lang}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onRunCommand(runCommandFor(f.path));
                  toast({ title: `Running ${f.name}`, variant: "info", duration: 1800 });
                }}
                title="Run now"
                className={cn(
                  "shrink-0 rounded p-0.5 text-primary opacity-0 transition-opacity",
                  "group-hover:opacity-70 hover:!opacity-100",
                )}
              >
                <HugeiconsIcon icon={PlayIcon} size={10} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => onOpenFile(f.path, f.name)}
                title="Open in editor"
                className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
              >
                <HugeiconsIcon icon={FileEditIcon} size={10} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(f.path)}
                title="Copy path"
                className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
              >
                <HugeiconsIcon icon={Copy01Icon} size={10} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
