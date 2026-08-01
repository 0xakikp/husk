import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  ComputerTerminal02Icon,
  PencilEdit02Icon,
  PinIcon,
  PlusSignIcon,
  Settings01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { fileIconUrl } from "../explorer/iconResolver";
import type { OpenFile } from "../editor/EditorArea";
import type { TermTab } from "../useTerminalTabs";
import type { ActiveTab } from "./types";

/* ── TabBar (husk v1 visual style, huskv2 data model) ─────────────────── */

const TAB_COLORS = [
  { name: "red", class: "border-l-red-500", hex: "#ef4444" },
  { name: "blue", class: "border-l-blue-500", hex: "#3b82f6" },
  { name: "green", class: "border-l-emerald-500", hex: "#10b981" },
  { name: "violet", class: "border-l-violet-500", hex: "#8b5cf6" },
  { name: "amber", class: "border-l-amber-500", hex: "#f59e0b" },
  { name: "cyan", class: "border-l-cyan-500", hex: "#06b6d4" },
  { name: "pink", class: "border-l-pink-500", hex: "#ec4899" },
  { name: "slate", class: "border-l-slate-500", hex: "#64748b" },
];

type TabChipProps = {
  active: boolean;
  onClick: () => void;
  onClose?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  animate?: boolean;
  color?: string;
  pinned?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  dragOver?: boolean;
  onMouseDragStart?: () => void;
  onMouseDragEnter?: () => void;
  onMouseDragEnd?: () => void;
  isMouseDragging?: boolean;
  children: React.ReactNode;
};

function TabChip({ active, onClick, onClose, onContextMenu, onDoubleClick, animate, color, pinned, draggable, onDragStart, onDragOver, onDrop, onDragEnd, dragOver, onMouseDragStart, onMouseDragEnter, onMouseDragEnd, isMouseDragging, children }: TabChipProps) {
  const chipRef = useRef<HTMLDivElement>(null);
  const mouseDownRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose?.();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!mouseDownRef.current) return;
    const dx = e.clientX - mouseDownRef.current.x;
    const dy = e.clientY - mouseDownRef.current.y;
    const dt = Date.now() - mouseDownRef.current.time;
    // If moved more than 5px or held for >300ms, treat as drag start
    if ((Math.abs(dx) > 5 || Math.abs(dy) > 5) && dt > 300) {
      onMouseDragStart?.();
    }
    mouseDownRef.current = null;
  };

  const handleMouseEnter = () => {
    if (isMouseDragging) {
      onMouseDragEnter?.();
    }
  };

  const handleMouseLeave = () => {
    if (isMouseDragging) {
      onMouseDragEnd?.();
    }
  };

  return (
    <div
      ref={chipRef}
      data-active-tab={active ? "true" : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "group relative flex h-6 shrink items-center gap-1 rounded-md text-xs transition-colors min-w-0 max-w-[160px] overflow-hidden border-l-2 select-none",
        onClose ? "pr-1" : "pr-2",
        active ? "bg-muted text-primary" : "text-muted-foreground hover:text-foreground",
        animate && "animate-tab-slide-in",
        color || "border-l-transparent",
        color,
        dragOver && "ring-1 ring-primary/50 bg-primary/5",
        draggable && "cursor-grab active:cursor-grabbing",
        isMouseDragging && "opacity-50",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 pl-2">
        {pinned && <HugeiconsIcon icon={PinIcon} size={9} className="shrink-0 opacity-60" />}
        {children}
      </div>
      {onClose ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close tab"
          onClick={handleCloseClick}
          onMouseDown={(e) => e.stopPropagation()}
          className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 group-hover:opacity-60 hover:!opacity-100"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2.25} />
        </div>
      ) : null}
    </div>
  );
}

export function TabBar({
  termTabs,
  openFiles,
  active,
  onSelectTerm,
  onSelectFile,
  onCloseTerm,
  onCloseFile,
  onNewTerm,
  onRenameTerm,
  onSetTabColor,
  onPinTerm,
  onUnpinTerm,
  onPinFile,
  onUnpinFile,
  onMoveTerm,
  onMoveFile,
  settingsOpen,
  onSelectSettings,
  onCloseSettings,
  onSelectAi,
  onPinAi,
  onUnpinAi,
  onSetAiTabColor,
  aiPinned,
  aiColor,
  animationsEnabled,
}: {
  termTabs: TermTab[];
  openFiles: OpenFile[];
  active: ActiveTab;
  onSelectTerm: (id: number) => void;
  onSelectFile: (path: string) => void;
  onCloseTerm: (id: number) => void;
  onCloseFile: (path: string) => void;
  onNewTerm: () => void;
  onRenameTerm: (id: number, title: string) => void;
  onSetTabColor: (id: number, color: string | undefined) => void;
  onPinTerm: (id: number) => void;
  onUnpinTerm: (id: number) => void;
  onPinFile: (path: string) => void;
  onUnpinFile: (path: string) => void;
  onMoveTerm: (fromIndex: number, toIndex: number) => void;
  onMoveFile: (fromIndex: number, toIndex: number) => void;
  settingsOpen: boolean;
  onSelectSettings: () => void;
  onCloseSettings: () => void;
  onSelectAi: () => void;
  onPinAi: () => void;
  onUnpinAi: () => void;
  onSetAiTabColor?: (color: string | undefined) => void;
  aiPinned: boolean;
  aiColor?: string;
  animationsEnabled?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "term" | "file" | "ai"; id: number; path?: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const canClose = termTabs.length + openFiles.length > 1;
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);

  // Mouse-based drag state (more reliable than HTML5 DnD in Tauri/WebKit)
  const [mouseDrag, setMouseDrag] = useState<{ kind: "term" | "file"; fromIndex: number } | null>(null);
  const [mouseDragOverIndex, setMouseDragOverIndex] = useState<number | null>(null);
  const [mouseDragOverFileIndex, setMouseDragOverFileIndex] = useState<number | null>(null);

  // Prevent default drag behavior on the tab bar container
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Update sliding indicator position when active tab changes
  useEffect(() => {
    const bar = tabBarRef.current;
    if (!bar) return;
    const activeTab = bar.querySelector('[data-active-tab="true"]') as HTMLElement | null;
    if (!activeTab) {
      setIndicatorStyle(null);
      return;
    }
    const barRect = bar.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    setIndicatorStyle({
      left: tabRect.left - barRect.left + 8,
      width: tabRect.width - 16,
    });
  }, [active, termTabs, openFiles, settingsOpen]);

  // Horizontal wheel scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const beginRename = (id: number, current: string) => {
    setMenu(null);
    setEditValue(current);
    setEditingId(id);
  };
  const commitRename = () => {
    if (editingId != null && editValue.trim()) onRenameTerm(editingId, editValue.trim());
    setEditingId(null);
  };

  return (
    <div
      ref={scrollRef}
      data-tauri-drag-region
      className="relative min-w-0 shrink overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-full min-w-0 items-center gap-0.5" ref={tabBarRef} onDragOver={handleDragOver}>
        {/* Pinned Husk AI tab — rendered first when pinned */}
        {aiPinned && (
          <TabChip
            active={active.kind === "ai"}
            onClick={onSelectAi}
            animate={animationsEnabled}
            pinned={true}
            color={aiColor}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, kind: "ai", id: -1 });
            }}
          >
            <HugeiconsIcon icon={SparklesIcon} size={13} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">Husk AI</span>
          </TabChip>
        )}

        {/* Pinned file tabs — rendered first so they appear at the far left */}
        {openFiles.filter((f) => f.pinned).map((f) => {
          const originalIndex = openFiles.findIndex((of) => of.path === f.path);
          return (
            <TabChip
              key={`f${f.path}`}
              active={active.kind === "file" && active.path === f.path}
              onClick={() => onSelectFile(f.path)}
              onClose={undefined}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, kind: "file", id: originalIndex, path: f.path });
              }}
              animate={animationsEnabled}
              pinned={true}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", `file:${f.path}`);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setMouseDragOverFileIndex(originalIndex);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const data = e.dataTransfer.getData("text/plain");
                const fromPath = data.startsWith("file:") ? data.slice(5) : null;
                const fromIndex = fromPath ? openFiles.findIndex((of) => of.path === fromPath) : -1;
                if (fromIndex >= 0 && fromIndex !== originalIndex) {
                  onMoveFile(fromIndex, originalIndex);
                }
                setMouseDragOverFileIndex(null);
              }}
              onDragEnd={() => {
                setMouseDragOverFileIndex(null);
              }}
              dragOver={mouseDragOverFileIndex === originalIndex}
              // Mouse-based drag fallback
              onMouseDragStart={() => setMouseDrag({ kind: "file", fromIndex: originalIndex })}
              onMouseDragEnter={() => {
                if (mouseDrag?.kind === "file" && mouseDrag.fromIndex !== originalIndex) {
                  setMouseDragOverFileIndex(originalIndex);
                }
              }}
              onMouseDragEnd={() => {
                if (mouseDrag?.kind === "file" && mouseDrag.fromIndex !== originalIndex && mouseDragOverFileIndex === originalIndex) {
                  onMoveFile(mouseDrag.fromIndex, originalIndex);
                }
                setMouseDrag(null);
                setMouseDragOverFileIndex(null);
              }}
              isMouseDragging={mouseDrag?.kind === "file" && mouseDrag.fromIndex === originalIndex}
            >
              <img src={fileIconUrl(f.name)} className="size-3.5 shrink-0" alt="" />
              <span className="truncate">{f.name}</span>
            </TabChip>
          );
        })}
        {/* Terminal tabs */}
        {termTabs.map((t, index) =>
          editingId === t.id ? (
            <div
              key={`t${t.id}`}
              className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 text-xs text-foreground"
            >
              <HugeiconsIcon icon={ComputerTerminal02Icon} size={12} strokeWidth={2} className="shrink-0" />
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
                className="w-24 min-w-0 bg-transparent text-foreground outline-none"
              />
            </div>
          ) : (
            <TabChip
              key={`t${t.id}`}
              active={active.kind === "term" && active.id === t.id}
              onClick={() => onSelectTerm(t.id)}
              onClose={t.pinned ? undefined : canClose ? () => onCloseTerm(t.id) : undefined}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, kind: "term", id: t.id });
              }}
              onDoubleClick={() => beginRename(t.id, t.title)}
              animate={animationsEnabled}
              color={t.color}
              pinned={t.pinned}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", `term:${index}`);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setMouseDragOverIndex(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const data = e.dataTransfer.getData("text/plain");
                const fromIndex = data.startsWith("term:") ? parseInt(data.split(":")[1]) : -1;
                if (fromIndex >= 0 && fromIndex !== index) {
                  onMoveTerm(fromIndex, index);
                }
                setMouseDragOverIndex(null);
              }}
              onDragEnd={() => {
                setMouseDragOverIndex(null);
              }}
              dragOver={mouseDragOverIndex === index}
              // Mouse-based drag fallback
              onMouseDragStart={() => setMouseDrag({ kind: "term", fromIndex: index })}
              onMouseDragEnter={() => {
                if (mouseDrag?.kind === "term" && mouseDrag.fromIndex !== index) {
                  setMouseDragOverIndex(index);
                }
              }}
              onMouseDragEnd={() => {
                if (mouseDrag?.kind === "term" && mouseDrag.fromIndex !== index && mouseDragOverIndex === index) {
                  onMoveTerm(mouseDrag.fromIndex, index);
                }
                setMouseDrag(null);
                setMouseDragOverIndex(null);
              }}
              isMouseDragging={mouseDrag?.kind === "term" && mouseDrag.fromIndex === index}
            >
              <HugeiconsIcon icon={ComputerTerminal02Icon} size={13} strokeWidth={1.75} className="shrink-0" />
              <span className="truncate">{t.title}</span>
            </TabChip>
          ),
        )}
        {/* Unpinned file tabs */}
        {openFiles.filter((f) => !f.pinned).map((f) => {
          const originalIndex = openFiles.findIndex((of) => of.path === f.path);
          return (
            <TabChip
              key={`f${f.path}`}
              active={active.kind === "file" && active.path === f.path}
              onClick={() => onSelectFile(f.path)}
              onClose={() => onCloseFile(f.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, kind: "file", id: originalIndex, path: f.path });
              }}
              animate={animationsEnabled}
              pinned={false}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", `file:${f.path}`);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setMouseDragOverFileIndex(originalIndex);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const data = e.dataTransfer.getData("text/plain");
                const fromPath = data.startsWith("file:") ? data.slice(5) : null;
                const fromIndex = fromPath ? openFiles.findIndex((of) => of.path === fromPath) : -1;
                if (fromIndex >= 0 && fromIndex !== originalIndex) {
                  onMoveFile(fromIndex, originalIndex);
                }
                setMouseDragOverFileIndex(null);
              }}
              onDragEnd={() => {
                setMouseDragOverFileIndex(null);
              }}
              dragOver={mouseDragOverFileIndex === originalIndex}
              // Mouse-based drag fallback
              onMouseDragStart={() => setMouseDrag({ kind: "file", fromIndex: originalIndex })}
              onMouseDragEnter={() => {
                if (mouseDrag?.kind === "file" && mouseDrag.fromIndex !== originalIndex) {
                  setMouseDragOverFileIndex(originalIndex);
                }
              }}
              onMouseDragEnd={() => {
                if (mouseDrag?.kind === "file" && mouseDrag.fromIndex !== originalIndex && mouseDragOverFileIndex === originalIndex) {
                  onMoveFile(mouseDrag.fromIndex, originalIndex);
                }
                setMouseDrag(null);
                setMouseDragOverFileIndex(null);
              }}
              isMouseDragging={mouseDrag?.kind === "file" && mouseDrag.fromIndex === originalIndex}
            >
              <img src={fileIconUrl(f.name)} className="size-3.5 shrink-0" alt="" />
              <span className="truncate">{f.name}</span>
            </TabChip>
          );
        })}
        {settingsOpen ? (
          <TabChip
            active={active.kind === "settings"}
            onClick={onSelectSettings}
            onClose={onCloseSettings}
            animate={animationsEnabled}
          >
            <HugeiconsIcon icon={Settings01Icon} size={13} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">Settings</span>
          </TabChip>
        ) : null}
        {!aiPinned && (
          <TabChip
            active={active.kind === "ai"}
            onClick={onSelectAi}
            animate={animationsEnabled}
            pinned={false}
            color={aiColor}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, kind: "ai", id: -1 });
            }}
          >
            <HugeiconsIcon icon={SparklesIcon} size={13} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">Husk AI</span>
          </TabChip>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
          title="New tab"
          onClick={onNewTerm}
        >
          <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={1.75} />
        </Button>

        {/* Sliding active tab indicator */}
        {indicatorStyle && (
          <span
            className="absolute bottom-0.5 h-[2px] rounded-full bg-[var(--accent)] opacity-80 transition-all duration-200 ease-out pointer-events-none"
            style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
          />
        )}

        {/* Context menu for rename/color/close */}
        {menu
          ? createPortal(
              <>
                <div
                  className="fixed inset-0 z-50"
                  onClick={() => setMenu(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu(null);
                  }}
                />
                <div
                  className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-md"
                  style={{ top: menu.y, left: menu.x }}
                  role="menu"
                >
                  {menu.kind === "term" ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                        onClick={() => {
                          const tab = termTabs.find((t) => t.id === menu.id);
                          if (tab?.pinned) {
                            onUnpinTerm(menu.id);
                          } else {
                            onPinTerm(menu.id);
                          }
                          setMenu(null);
                        }}
                      >
                        <HugeiconsIcon icon={PinIcon} size={14} strokeWidth={1.75} />
                        <span className="flex-1 text-left">
                          {termTabs.find((t) => t.id === menu.id)?.pinned ? "Unpin" : "Pin"}
                        </span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                        onClick={() => beginRename(menu.id, termTabs.find((t) => t.id === menu.id)?.title ?? "")}
                      >
                        <HugeiconsIcon icon={PencilEdit02Icon} size={14} strokeWidth={1.75} />
                        <span className="flex-1 text-left">Rename</span>
                      </button>
                      {/* Color picker */}
                      <div className="px-2 py-1.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Color</span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {TAB_COLORS.map((c) => (
                            <button
                              key={c.name}
                              type="button"
                              onClick={() => {
                                onSetTabColor(menu.id, c.class);
                                setMenu(null);
                              }}
                              className={cn(
                                "size-4 rounded-full ring-1 ring-transparent transition-all hover:scale-110",
                                termTabs.find((t) => t.id === menu.id)?.color === c.class && "ring-white/60 scale-110"
                              )}
                              style={{ backgroundColor: c.hex }}
                              title={c.name}
                            />
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              onSetTabColor(menu.id, undefined);
                              setMenu(null);
                            }}
                            className="flex size-4 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80"
                            title="Clear"
                          >
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2">
                              <path d="M1 1l6 6M7 1L1 7" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </>
                  ) : menu.kind === "file" ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                        onClick={() => {
                          const file = openFiles.find((f) => f.path === menu.path);
                          if (file?.pinned) {
                            onUnpinFile(menu.path!);
                          } else {
                            onPinFile(menu.path!);
                          }
                          setMenu(null);
                        }}
                      >
                        <HugeiconsIcon icon={PinIcon} size={14} strokeWidth={1.75} />
                        <span className="flex-1 text-left">
                          {openFiles.find((f) => f.path === menu.path)?.pinned ? "Unpin" : "Pin"}
                        </span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                        onClick={() => {
                          if (aiPinned) {
                            onUnpinAi();
                          } else {
                            onPinAi();
                          }
                          setMenu(null);
                        }}
                      >
                        <HugeiconsIcon icon={PinIcon} size={14} strokeWidth={1.75} />
                        <span className="flex-1 text-left">{aiPinned ? "Unpin" : "Pin"}</span>
                      </button>
                      {/* Color picker */}
                      <div className="px-2 py-1.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Color</span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {TAB_COLORS.map((c) => (
                            <button
                              key={c.name}
                              type="button"
                              onClick={() => {
                                onSetAiTabColor?.(c.class);
                                setMenu(null);
                              }}
                              className={cn(
                                "size-4 rounded-full ring-1 ring-transparent transition-all hover:scale-110",
                                aiColor === c.class && "ring-white/60 scale-110"
                              )}
                              style={{ backgroundColor: c.hex }}
                              title={c.name}
                            />
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              onSetAiTabColor?.(undefined);
                              setMenu(null);
                            }}
                            className="flex size-4 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80"
                            title="Clear"
                          >
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2">
                              <path d="M1 1l6 6M7 1L1 7" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                  {canClose && menu.kind !== "ai" ? (
                    <button
                      type="button"
                      role="menuitem"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                        (menu.kind === "term" && termTabs.find((t) => t.id === menu.id)?.pinned) ||
                        (menu.kind === "file" && openFiles.find((f) => f.path === menu.path)?.pinned)
                          ? "text-muted-foreground cursor-not-allowed"
                          : "text-destructive"
                      )}
                      onClick={() => {
                        if (menu.kind === "term") {
                          const tab = termTabs.find((t) => t.id === menu.id);
                          if (!tab?.pinned) onCloseTerm(menu.id);
                        } else if (menu.kind === "file") {
                          const file = openFiles.find((f) => f.path === menu.path);
                          if (!file?.pinned) onCloseFile(menu.path!);
                        }
                        setMenu(null);
                      }}
                      disabled={
                        (menu.kind === "term" && termTabs.find((t) => t.id === menu.id)?.pinned) ||
                        (menu.kind === "file" && openFiles.find((f) => f.path === menu.path)?.pinned)
                      }
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
                      <span className="flex-1 text-left">Close</span>
                    </button>
                  ) : null}
                </div>
              </>,
              document.body,
            )
          : null}
      </div>
    </div>
  );
}

