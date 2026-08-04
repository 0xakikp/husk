import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { getPrefs, setPrefs } from "../settings/preferences";

/**
 * The inspector — a resizable pane below the work area for resource detail.
 *
 * Kubernetes and Docker detail used to render as `absolute inset-0` layers over
 * the whole workspace, and the terminal layer explicitly added
 * `invisible pointer-events-none` whenever something was selected. Opening a pod
 * therefore hid the shell, and you had to close the pod to run a command about
 * it — which is backwards, because reading a pod is when you most want the shell.
 *
 * ── Why the bottom edge and not a third column ───────────────────────────────
 * A column would put four of them on screen once the sidebar and the AI dock are
 * open: 220 + 380 + 420 leaves the terminal about 55 characters wide on a 1440px
 * display. Detail content is also the wrong shape for a narrow column — pod
 * events, describe output, YAML and log lines are wide, and at 420px every line
 * truncates.
 *
 * Taking height instead caps the layout at three columns permanently, keeps both
 * the terminal and the detail full width, and leaves the AI dock alone: it is a
 * column, this is a row, so the two never compete for the same space.
 *
 * ── Why height is uncontrolled ───────────────────────────────────────────────
 * Dragging writes straight to the element's style through a ref instead of React
 * state. setPrefs serialises every preference to localStorage and notifies every
 * usePrefs() consumer, so calling it per pointermove meant ~60 whole-app
 * re-renders and storage writes a second — and each one resizes the terminal,
 * which re-fits xterm. The drag felt heavy for that reason alone. Prefs are
 * written once, on release.
 */
export function Inspector({
  title,
  onClose,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHRef = useRef(0);
  /* Read once. After mount the DOM owns the height, so a prefs change elsewhere
     will not fight the drag. */
  const initialRef = useRef(getPrefs().inspectorHeight);

  /** Keep at least this much terminal visible, whatever the drag asks for. */
  const clamp = (h: number) => Math.min(Math.max(160, window.innerHeight - 260), Math.max(120, h));

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !paneRef.current) return;
    e.preventDefault();
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startHRef.current = paneRef.current.getBoundingClientRect().height;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
    // The handle keeps the pointer even when the cursor outruns it.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const pane = paneRef.current;
      if (!draggingRef.current || !pane) return;
      // Dragging up grows the pane, so the delta is inverted.
      pane.style.height = `${clamp(startHRef.current + (startYRef.current - e.clientY))}px`;
    };
    const onUp = () => {
      const pane = paneRef.current;
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (pane) setPrefs({ inspectorHeight: Math.round(pane.getBoundingClientRect().height) });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  return (
    <div
      ref={paneRef}
      /* The pane takes its height immediately and only its contents animate.
         Transitioning the height itself would resize the terminal every frame,
         and xterm re-fits on each resize — so a 200ms open would trigger dozens
         of reflows of the very thing you are trying not to disturb. One resize,
         and the panel slides into the space it just took. */
      className="animate-inspector-in flex shrink-0 flex-col overflow-hidden rounded-lg border border-[var(--border)]"
      style={{ height: initialRef.current }}
    >
      {/* Grab strip on the top edge, as its own row rather than an absolutely
          positioned overlay, so it cannot sit on top of the header's buttons. */}
      <div
        onPointerDown={onPointerDown}
        className="group flex h-1.5 shrink-0 cursor-ns-resize items-center justify-center"
        style={{ touchAction: "none" }}
        title="Drag to resize"
      >
        <span className="h-px w-8 rounded bg-border/60 transition-colors group-hover:bg-primary/60" />
      </div>

      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border/40 px-2">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-primary">{title}</span>
        <button
          type="button"
          onClick={onClose}
          title="Close inspector"
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded",
            "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          )}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
