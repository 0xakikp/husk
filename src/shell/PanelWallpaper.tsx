import { cn } from "@/lib/utils";
import type { Prefs } from "../settings/preferences";

/**
 * The wallpaper, painted inside one panel rather than behind the whole window.
 *
 * It used to be a single fixed layer at z-index -2 under the entire app. Since
 * it sat below everything, any pixel that no panel covered showed it: the strip
 * between the sidebar and the terminal, the space around the breadcrumb, and a
 * frame along every window edge. Those gaps are meant to read as empty space,
 * not as windows onto the image.
 *
 * Scoping it here makes every gap plain black and lets the panel's own
 * `overflow-hidden rounded-lg` clip the image to the rounded corners.
 *
 * The host must be `relative isolate overflow-hidden`. `isolate` is what makes
 * the -z-10 layers land *above* the host's own background but *below* its
 * content — without it they fall behind the nearest stacking context (#root,
 * which is opaque black) and vanish.
 */
export function PanelWallpaper({
  src,
  background,
}: {
  src: string;
  background: Prefs["background"];
}) {
  /* blur() samples beyond the element's edges, so an image sized exactly to the
     box fades out along its own border — four soft seams just inside the panel.
     Bleeding it out by twice the radius pushes that falloff past the clip. */
  const bleed = background.blur > 0 ? background.blur * 2 : 0;
  const span = `calc(100% + ${bleed * 2}px)`;

  return (
    <>
      <img
        src={src}
        alt=""
        aria-hidden
        className={cn(
          "pointer-events-none absolute -z-10",
          background.fit === "contain" ? "object-contain" : "object-cover",
        )}
        /* Explicit width/height: an absolutely positioned <img> is a replaced
           element, so `width: auto` resolves to the image's intrinsic size
           rather than stretching between left/right insets. */
        style={{
          left: -bleed,
          top: -bleed,
          width: span,
          height: span,
          opacity: background.opacity / 100,
          filter: background.blur > 0 ? `blur(${background.blur}px)` : undefined,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ backgroundColor: `rgba(0,0,0,${background.dim / 100})` }}
      />
    </>
  );
}
