import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { TerminalTabsApi } from "@/useTerminalTabs";
import type { OpenFile } from "@/editor/EditorArea";
import type { ActiveTab } from "@/App";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ComputerTerminal02Icon,
  File01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";

type SwitcherItem =
  | { kind: "term"; id: number; title: string }
  | { kind: "file"; path: string; name: string }
  | { kind: "settings" };

export function QuickSwitcher({
  open,
  term,
  openFiles,
  active,
  settingsOpen,
  onSelect,
  onClose,
}: {
  open: boolean;
  term: TerminalTabsApi;
  openFiles: OpenFile[];
  active: ActiveTab;
  settingsOpen: boolean;
  onSelect: (item: ActiveTab) => void;
  onClose: () => void;
}) {
  const items = useMemo<SwitcherItem[]>(() => {
    const list: SwitcherItem[] = [
      ...term.tabs.map((t) => ({ kind: "term" as const, id: t.id, title: t.title })),
      ...openFiles.map((f) => ({ kind: "file" as const, path: f.path, name: f.name })),
    ];
    if (settingsOpen) list.push({ kind: "settings" });
    return list;
  }, [term.tabs, openFiles, settingsOpen]);

  const [selectedIdx, setSelectedIdx] = useState(() => {
    return items.findIndex((i) => {
      if (active.kind === "term" && i.kind === "term") return i.id === active.id;
      if (active.kind === "file" && i.kind === "file") return i.path === active.path;
      if (active.kind === "settings" && i.kind === "settings") return true;
      return false;
    });
  });

  useEffect(() => {
    if (!open) return;
    const idx = items.findIndex((i) => {
      if (active.kind === "term" && i.kind === "term") return i.id === active.id;
      if (active.kind === "file" && i.kind === "file") return i.path === active.path;
      if (active.kind === "settings" && i.kind === "settings") return true;
      return false;
    });
    setSelectedIdx(Math.max(0, idx));
  }, [open, items, active]);

  const gridRef = useRef<HTMLDivElement>(null);

  const commit = useCallback(
    (idx: number) => {
      const item = items[idx];
      if (!item) return;
      if (item.kind === "term") onSelect({ kind: "term", id: item.id });
      else if (item.kind === "file") onSelect({ kind: "file", path: item.path });
      else onSelect({ kind: "settings" });
      onClose();
    },
    [items, onSelect, onClose],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      const cols = 3;
      let next = selectedIdx;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next = Math.min(items.length - 1, selectedIdx + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        next = Math.max(0, selectedIdx - 1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        next = Math.min(items.length - 1, selectedIdx + cols);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        next = Math.max(0, selectedIdx - cols);
      } else if (e.key === "Enter") {
        e.preventDefault();
        commit(selectedIdx);
        return;
      }
      if (next !== selectedIdx) {
        setSelectedIdx(next);
        requestAnimationFrame(() => {
          const el = gridRef.current?.children[next] as HTMLElement | undefined;
          el?.scrollIntoView({ block: "nearest" });
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selectedIdx, items.length, onClose, commit]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      {/* dim backdrop */}
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div
        className="relative z-10 flex max-h-[80vh] w-full max-w-[700px] flex-col rounded-xl border border-border bg-card p-5 shadow-[0_24px_70px_rgba(0,0,0,0.7)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-center text-sm text-muted-foreground">
          Quick Switcher — <kbd className="rounded border border-border/40 bg-muted/40 px-1 text-[10px]">↑</kbd>{" "}
          <kbd className="rounded border border-border/40 bg-muted/40 px-1 text-[10px]">↓</kbd>{" "}
          <kbd className="rounded border border-border/40 bg-muted/40 px-1 text-[10px]">←</kbd>{" "}
          <kbd className="rounded border border-border/40 bg-muted/40 px-1 text-[10px]">→</kbd> navigate,{" "}
          <kbd className="rounded border border-border/40 bg-muted/40 px-1 text-[10px]">Enter</kbd> select,{" "}
          <kbd className="rounded border border-border/40 bg-muted/40 px-1 text-[10px]">Esc</kbd> close
        </div>
        <div ref={gridRef} className="grid grid-cols-3 gap-2 overflow-y-auto">
          {items.map((item, i) => {
            const selected = i === selectedIdx;
            return (
              <button
                key={item.kind === "term" ? `t-${item.id}` : item.kind === "file" ? `f-${item.path}` : "settings"}
                type="button"
                onClick={() => commit(i)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-xs transition-all",
                  selected
                    ? "border-primary bg-primary/10 text-foreground shadow-[0_0_12px_rgba(var(--accent-rgb),0.25)]"
                    : "border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                {item.kind === "term" ? (
                  <>
                    <HugeiconsIcon icon={ComputerTerminal02Icon} size={24} strokeWidth={1.5} />
                    <span className="truncate max-w-full">{item.title}</span>
                  </>
                ) : item.kind === "file" ? (
                  <>
                    <HugeiconsIcon icon={File01Icon} size={24} strokeWidth={1.5} />
                    <span className="truncate max-w-full">{item.name}</span>
                  </>
                ) : (
                  <>
                    <HugeiconsIcon icon={Settings01Icon} size={24} strokeWidth={1.5} />
                    <span>Settings</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
