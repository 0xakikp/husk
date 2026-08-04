import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { setPrefs } from "../settings/preferences";

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
 */
export function Inspector({
  title,
  height,
  onClose,
  children,
}: {
  title: ReactNode;
  height: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHRef = useRef(0);
  const latestRef = useRef(height);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      startYRef.current = e.clientY;
      startHRef.current = height;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ns-resize";
    },
    [height],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      /* Dragging up grows the pane, so the delta is inverted. Clamped: below
         ~120px nothing useful is visible, and the upper bound leaves the terminal
         at least 160px rather than letting the inspector swallow it. */
      const next = Math.round(startHRef.current + (startYRef.current - e.clientY));
      const max = Math.max(160, window.innerHeight - 260);
      latestRef.current = Math.min(max, Math.max(120, next));
      setPrefs({ inspectorHeight: latestRef.current });
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-[var(--border)]"
      style={{ height }}
    >
      {/* Grab strip on the top edge. Its own row rather than an absolutely
          positioned overlay, so it cannot sit on top of the header's buttons. */}
      <div
        onPointerDown={onPointerDown}
        className="group flex h-1.5 shrink-0 cursor-ns-resize items-center justify-center"
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
