import { useEffect } from "react";

/**
 * Makes every dialog in the app draggable by its header, installed once as a
 * single capture-phase listener rather than wired into each dialog.
 *
 * husk has three unrelated modal systems — the shared Radix `Modal`, the
 * `.modal-backdrop` CSS classes, and a few ad-hoc portals in Notes/Bookmarks.
 * Rather than teach each one to drag, this matches on the header and walks up
 * to the card, so all three work and anything added later does too.
 *
 * A drag handle is `[data-drag-handle]` or `.modal-header`. The card it moves is
 * the nearest `[data-movable]` or `.modal` ancestor, falling back to the
 * handle's parent — which is the card in every ad-hoc portal here.
 *
 * ── Why transform, and why it matters ────────────────────────────────────────
 * This first moved the card by writing `margin-left`/`margin-top`. That worked,
 * but margin is a layout property: every pointer move invalidated layout and
 * forced a reflow before the frame could paint, so the dialog visibly trailed
 * the cursor no matter the display's refresh rate.
 *
 * `transform` is handled by the compositor — no layout, no repaint of the card's
 * contents — so the move lands in the same frame as the pointer event. Chromium
 * already dispatches pointermove aligned to the frame, so the write happens
 * directly in the handler: batching into rAF would only add a frame of latency.
 *
 * The reason margin was chosen originally is real, though — Radix centres its
 * content with `-translate-x-1/2 -translate-y-1/2` and `.modal` animates in with
 * a transform, so a naive `transform` write would wipe both out. The fix is to
 * capture whatever transform the card already has, once, and compose the drag
 * offset in front of it.
 */
export function useDialogDrag() {
  useEffect(() => {
    let card: HTMLElement | null = null;
    let baseTransform = "";
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    let startLeft = 0;
    let startTop = 0;
    let width = 0;
    let captureEl: HTMLElement | null = null;

    /** Keep this much of the card on screen, so it can never be lost offscreen. */
    const KEEP_VISIBLE = 120;

    const write = (x: number, y: number) => {
      if (!card) return;
      // translate3d rather than translate: promotes the card to its own
      // compositor layer, so dragging never repaints what is behind it.
      card.style.transform = `translate3d(${x}px, ${y}px, 0)${baseTransform}`;
      card.dataset.dragX = String(x);
      card.dataset.dragY = String(y);
    };

    const onMove = (e: PointerEvent) => {
      if (!card) return;

      const wantX = originX + (e.clientX - startX);
      const wantY = originY + (e.clientY - startY);

      // Clamp in viewport space: where the card's edges would land, given the
      // position it had before this drag began.
      const left = startLeft - originX + wantX;
      const top = startTop - originY + wantY;
      const clampedLeft = Math.min(
        Math.max(left, KEEP_VISIBLE - width),
        window.innerWidth - KEEP_VISIBLE,
      );
      // Never above the top edge: the header is the only way to grab it back.
      const clampedTop = Math.min(Math.max(top, 0), window.innerHeight - 40);

      write(wantX + (clampedLeft - left), wantY + (clampedTop - top));
    };

    const onUp = (e: PointerEvent) => {
      if (card) card.style.willChange = "";
      captureEl?.releasePointerCapture?.(e.pointerId);
      captureEl = null;
      card = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("pointermove", onMove);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest) return;

      const handle = target.closest<HTMLElement>("[data-drag-handle], .modal-header");
      if (!handle) return;

      // Sidebar sheets are clipped to the panel they live in, so moving one
      // could only ever push it out of sight.
      if (handle.closest(".sidebar-sheet")) return;

      // A header holds the close button, tabs and tooltips. Dragging must not
      // swallow their clicks, and text in the title should stay selectable.
      if (target.closest("button, a, input, textarea, select, [role='button'], [role='tab']")) return;

      const found =
        handle.closest<HTMLElement>("[data-movable], .modal") ?? handle.parentElement;
      if (!found) return;

      card = found;

      // Capture the card's own transform once and keep it: after the first drag
      // the computed transform includes our offset, so re-reading it would
      // compound. dragBase survives on the element for as long as it is mounted.
      if (card.dataset.dragBase === undefined) {
        const own = getComputedStyle(card).transform;
        card.dataset.dragBase = own && own !== "none" ? ` ${own}` : "";
      }
      baseTransform = card.dataset.dragBase;

      originX = Number(card.dataset.dragX ?? 0);
      originY = Number(card.dataset.dragY ?? 0);
      const rect = card.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      width = rect.width;
      startX = e.clientX;
      startY = e.clientY;

      // Hint the compositor before the first move so the layer is ready by then
      // rather than being promoted mid-drag, which shows up as a hitch.
      card.style.willChange = "transform";
      // Without this a drag across the dialog selects its label text, and the
      // cursor flickers whenever it crosses a child with its own cursor.
      document.body.style.userSelect = "none";
      document.body.style.cursor = "move";
      // Keeps the drag alive if the pointer outruns the header, which at speed
      // it always does.
      captureEl = handle;
      handle.setPointerCapture?.(e.pointerId);

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp, { once: true });
      document.addEventListener("pointercancel", onUp, { once: true });
    };

    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);
}
