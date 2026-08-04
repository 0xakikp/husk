/**
 * The launcher's surface, shared so other ⌘K-reachable panels can wear it.
 *
 * Anything opened *from* the launcher should look like it came from there.
 * Authenticator did not: it was a corner dropdown, then a centred dialog with
 * the app's generic `.modal` chrome, so following "Open authenticator" out of
 * ⌘K landed you somewhere visually unrelated.
 *
 * Kept as one exported string rather than copied into each panel, because these
 * values only work as a set — the translucency needs the blur, the blur needs a
 * dim-free overlay behind it, and the radius has to match or the panels read as
 * two different widgets. Duplicating them guarantees they drift.
 */

/** Panel container: top-anchored, 520px, frosted. */
export const PALETTE_SURFACE =
  "w-full max-w-[520px] overflow-hidden rounded-xl border border-border/40 bg-background/70 shadow-lg backdrop-blur-xl";

/**
 * Backdrop for a palette-style panel that is not a Radix CommandDialog.
 *
 * Top-anchored at 12vh to sit where the launcher sits, rather than centred —
 * a panel that appears in a different place reads as a different panel even
 * when it is styled identically.
 */
export const PALETTE_BACKDROP =
  "fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]";

/** The rounded input capsule, for panels that carry their own filter field. */
export const PALETTE_CAPSULE =
  "group relative flex h-11 items-center gap-2 rounded-full border border-accent/20 bg-white/[0.03] px-2.5 focus-within:border-accent/60";
