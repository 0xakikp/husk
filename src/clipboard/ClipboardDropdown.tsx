import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useClipHistory, clearClips } from "./store";
import { toast } from "../toast";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { HugeiconsIcon } from "@hugeicons/react";
import { ClipboardIcon, Delete02Icon } from "@hugeicons/core-free-icons";

/** Clipboard history as a toolbar dropdown (husk v1 style) instead of a modal. */
export function ClipboardDropdown() {
  const history = useClipHistory();
  const copy = (t: string) => {
    void writeText(t);
    toast({ title: "Copied to clipboard", variant: "info" });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Clipboard history"
          title="Clipboard history"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon icon={ClipboardIcon} size={16} strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex h-9 items-center justify-between border-b border-border/60 px-3">
          <span className="text-xs font-medium text-foreground">Clipboard history</span>
          <button
            type="button"
            title="Clear"
            onClick={clearClips}
            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.75} />
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {history.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11.5px] text-muted-foreground">
              Nothing captured yet. Copy something and it'll show up here.
            </p>
          ) : (
            history.map((t, i) => (
              <button
                key={`${i}-${t.slice(0, 12)}`}
                type="button"
                title="Copy"
                onClick={() => copy(t)}
                className="block w-full truncate rounded px-2 py-1.5 text-left font-mono text-[11.5px] text-foreground transition-colors hover:bg-muted"
              >
                {t.length > 140 ? `${t.slice(0, 140)}…` : t}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
