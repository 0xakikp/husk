import { cn } from "@/lib/utils";

/**
 * A spinner, for waits that shell out.
 *
 * Static "Loading…" text was the previous signal, and `lazyPanel`'s fallback
 * showed only the panel's name — so opening Kubernetes displayed the word
 * "Kubernetes" and nothing else while kubectl ran. With no movement on screen
 * a slow cluster is indistinguishable from a frozen app, which is the one
 * impression a terminal tool cannot afford.
 *
 * A rotating ring rather than a pulsing icon: rotation reads as "still working"
 * even at the edge of vision, where a fade can be mistaken for a static
 * gradient.
 */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-[1.5px] border-current/25 border-t-current",
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}

/** Spinner plus label, for a pane that has nothing else to show yet. */
export function LoadingRow({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-4 text-[11px] text-muted-foreground", className)}>
      <Spinner size={12} />
      <span>{label}</span>
    </div>
  );
}
