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

/**
 * The rounded input capsule. Includes `command-capsule`, which carries the inset
 * highlight and the focus glow in CSS — without it the capsule has a hard accent
 * ring instead of the launcher's soft one, which is most of why a copy looks
 * "nearly right but wrong".
 */
export const PALETTE_CAPSULE =
  "command-capsule group relative flex h-11 items-center gap-2 rounded-full border border-accent/20 bg-white/[0.03] px-2.5 focus-within:border-accent/60";

/**
 * The input inside the capsule.
 *
 * The ring-0/shadow-none/focus-visible resets are not defensive noise — something
 * in the base layer rings inputs, and without them the field draws its own
 * rectangle inside the rounded capsule. Any panel reusing the capsule needs this
 * exact list, which is why it is exported rather than retyped.
 */
export const PALETTE_INPUT =
  "h-full w-full min-w-0 border-0 bg-transparent text-[15px] text-foreground caret-accent outline-none ring-0 shadow-none placeholder:text-muted-foreground/35 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50";

/** The `esc` hint that sits at the right end of the capsule. */
export const PALETTE_ESC =
  "pointer-events-none shrink-0 rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9.5px] tracking-wider text-muted-foreground/50";
