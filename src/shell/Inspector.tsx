import { useCallback, useEffect, useRef, type ReactNode } from "react";
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
 * ── Why there is no header here ──────────────────────────────────────────────
 * Every detail panel already draws its own h-11 header with the title, subtitle,
 * copy and a close that calls the same handler — they were built as full-screen
 * views. A header here meant two stacked title bars and ~28px of a short pane
 * spent saying the same thing twice. This contributes only the grab strip; the
 * panel owns its own chrome.
 *
 * ── Why height is uncontrolled ───────────────────────────────────────────────
 * Dragging writes straight to the element's style through a ref instead of React
 * state. setPrefs serialises every preference to localStorage and notifies every
 * usePrefs() consumer, so calling it per pointermove meant ~60 whole-app
 * re-renders and storage writes a second — and each one resizes the terminal,
 * which re-fits xterm. The drag felt heavy for that reason alone. Prefs are
 * written once, on release.
 */
export function Inspector({ children }: { children: ReactNode }) {
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
        className="husk-resize-seam husk-resize-seam-horizontal flex h-1.5 shrink-0 cursor-ns-resize items-center justify-center"
        style={{ touchAction: "none" }}
        title="Drag to resize"
      >
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
