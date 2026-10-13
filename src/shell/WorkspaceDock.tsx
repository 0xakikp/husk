import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import type { Pane } from "../terminalPanes";
import { clampWorkspaceDockHeight, parseWorkspaceDockHeight, WORKSPACE_DOCK_HEADER_HEIGHT, WORKSPACE_DOCK_HEIGHT_KEY, workspaceDockGeometry } from "./workspaceDockLayout";
import "./WorkspaceDock.css";

export type WorkspaceDockProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  terminalRoot: Pane;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Effective body visibility, including temporary geometry constraints. */
  onExpandedChange?: (expanded: boolean) => void;
  onUserCollapse?: () => void;
  header: (state: { cramped: boolean; expanded: boolean }) => ReactNode;
  children: ReactNode;
};

type Drag = {
  pointerId: number;
  target: HTMLElement;
  startY: number;
  startHeight: number;
  height: number;
  cursor: string;
  userSelect: string;
};

function readHeight(): number | null {
  try { return parseWorkspaceDockHeight(localStorage.getItem(WORKSPACE_DOCK_HEIGHT_KEY)); }
  catch { return null; }
}

function persistHeight(height: number) {
  // Dock geometry is local UI state, never an application-wide preferences update.
  try { localStorage.setItem(WORKSPACE_DOCK_HEIGHT_KEY, String(height)); }
  catch { /* A storage restriction must not make the resize unusable. */ }
}

export function WorkspaceDock({ containerRef, terminalRoot, collapsed, onCollapsedChange, onExpandedChange, onUserCollapse, header, children }: WorkspaceDockProps) {
  const paneRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);
  const [preferredHeight, setPreferredHeight] = useState(readHeight);
  const dragRef = useRef<Drag | null>(null);
  const collapseRequested = useRef(false);
  const geometry = workspaceDockGeometry(availableHeight ?? 0, terminalRoot, preferredHeight);
  const expanded = !collapsed && !geometry.cramped;
  const renderedHeight = expanded ? geometry.height : WORKSPACE_DOCK_HEADER_HEIGHT;
  const layoutRef = useRef({ geometry, expanded });
  layoutRef.current = { geometry, expanded };

  useEffect(() => { onExpandedChange?.(expanded); }, [expanded, onExpandedChange]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      const style = getComputedStyle(container);
      const px = (value: string) => Number.parseFloat(value) || 0;
      const chrome = px(style.borderTopWidth) + px(style.borderBottomWidth)
        + px(style.paddingTop) + px(style.paddingBottom) + px(style.rowGap);
      setAvailableHeight(Math.max(0, rect.height - chrome));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [containerRef]);

  useEffect(() => {
    if (!geometry.cramped || collapsed) collapseRequested.current = false;
    if (availableHeight !== null && availableHeight > 0 && geometry.cramped && !collapsed && !collapseRequested.current) {
      collapseRequested.current = true;
      // Once space runs out, remain collapsed until the user explicitly opens
      // a tab again. A later window resize must not unexpectedly consume height.
      onCollapsedChange(true);
    }
  }, [availableHeight, collapsed, geometry.cramped, onCollapsedChange]);

  const finishDrag = useCallback((commit: boolean) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    document.body.style.cursor = drag.cursor;
    document.body.style.userSelect = drag.userSelect;
    if (drag.target.hasPointerCapture?.(drag.pointerId)) drag.target.releasePointerCapture?.(drag.pointerId);
    const { geometry: current, expanded: stillExpanded } = layoutRef.current;
    if (commit && stillExpanded) {
      const height = clampWorkspaceDockHeight(drag.height, current.maxHeight);
      if (paneRef.current) paneRef.current.style.height = `${height}px`;
      handleRef.current?.setAttribute("aria-valuenow", String(height));
      setPreferredHeight(height);
      persistHeight(height);
    } else {
      const height = stillExpanded ? current.height : WORKSPACE_DOCK_HEADER_HEIGHT;
      if (paneRef.current) paneRef.current.style.height = `${height}px`;
      handleRef.current?.setAttribute("aria-valuenow", String(height));
    }
  }, []);

  useEffect(() => {
    const onMove = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      const { geometry: current, expanded: stillExpanded } = layoutRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !stillExpanded) return;
      drag.height = clampWorkspaceDockHeight(drag.startHeight + drag.startY - event.clientY, current.maxHeight);
      if (paneRef.current) paneRef.current.style.height = `${drag.height}px`;
      handleRef.current?.setAttribute("aria-valuenow", String(drag.height));
    };
    const onUp = (event: globalThis.PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) finishDrag(true);
    };
    const onCancel = (event: globalThis.PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) finishDrag(false);
    };
    const onBlur = () => finishDrag(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
      finishDrag(false);
    };
  }, [finishDrag]);

  useLayoutEffect(() => {
    // A window resize or changed split ratio can invalidate an in-flight drag.
    // Cancel rather than persisting a height measured against an obsolete box.
    finishDrag(false);
  }, [availableHeight, terminalRoot, expanded, finishDrag]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !expanded || dragRef.current) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startY: event.clientY,
      startHeight: geometry.height,
      height: geometry.height,
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const requested = event.key === "ArrowUp" ? geometry.height + 20
      : event.key === "ArrowDown" ? geometry.height - 20
        : event.key === "Home" ? geometry.minHeight
          : event.key === "End" ? geometry.maxHeight : null;
    if (!expanded || requested === null) return;
    event.preventDefault();
    finishDrag(false);
    const height = clampWorkspaceDockHeight(requested, geometry.maxHeight);
    setPreferredHeight(height);
    persistHeight(height);
  };

  const toggleCollapsed = () => {
    if (geometry.cramped) return;
    onCollapsedChange(expanded);
    if (expanded) onUserCollapse?.();
  };

  return (
    <div ref={paneRef} className="workspace-dock" style={{ height: renderedHeight }} data-expanded={expanded} data-cramped={geometry.cramped}>
      {expanded && <div
        ref={handleRef}
        className="workspace-dock__resize husk-resize-seam husk-resize-seam-horizontal absolute"
        role="separator"
        tabIndex={0}
        aria-label="Resize workspace dock"
        aria-orientation="horizontal"
        aria-controls={contentId}
        aria-valuemin={geometry.minHeight}
        aria-valuemax={geometry.maxHeight}
        aria-valuenow={geometry.height}
        title="Resize workspace dock (Arrow Up / Down)"
        onPointerDown={onPointerDown}
        onLostPointerCapture={() => finishDrag(false)}
        onKeyDown={onKeyDown}
      />}
      <div
        className="workspace-dock__header"
        title={geometry.cramped ? undefined : expanded ? "Double-click to collapse workspace dock" : "Double-click to expand workspace dock"}
        onDoubleClick={(event) => {
          if (geometry.cramped || event.defaultPrevented) return;
          const target = event.target;
          // Keep tab, menu and full-tab actions independent of this shortcut,
          // including events bubbling through React portals.
          if (!(target instanceof Element) || !event.currentTarget.contains(target)
            || target.closest("button, a, input, select, textarea, [role='button'], [role='tab'], [role^='menuitem'], [contenteditable]:not([contenteditable='false'])")) return;
          event.preventDefault();
          toggleCollapsed();
        }}
      >
        <div className="workspace-dock__tabs">{header({ cramped: geometry.cramped, expanded })}</div>
        <button
          type="button"
          className="workspace-dock__toggle"
          aria-label={expanded ? "Collapse workspace dock" : "Expand workspace dock"}
          aria-expanded={expanded}
          aria-controls={contentId}
          disabled={geometry.cramped}
          title={geometry.cramped ? "More vertical space is needed to open the workspace dock" : expanded ? "Collapse workspace dock" : "Expand workspace dock"}
          onClick={toggleCollapsed}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d={expanded ? "M3 4.5 6 7.5 9 4.5" : "M3 7.5 6 4.5 9 7.5"} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div id={contentId} className="workspace-dock__content" hidden={!expanded} aria-hidden={!expanded} inert={!expanded}>{children}</div>
    </div>
  );
}
