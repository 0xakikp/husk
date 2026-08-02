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
 * handle's parent — which is the card in every ad-hoc portal here, so those need
 * one attribute rather than two.
 *
 * Offsets go on **margin**, not transform. Radix centres its content with
 * `-translate-x-1/2 -translate-y-1/2`, and the `.modal` cards animate with a
 * transform on open; writing to `transform` would fight both. Margins are
 * untouched by either and shift a flex-centred or `left: 50%` box identically.
 */
export function useDialogDrag() {
  useEffect(() => {
    let card: HTMLElement | null = null;
    let startRect: DOMRect | null = null;
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;

    /** Keep this much of the card on screen, so it can never be lost offscreen. */
    const KEEP_VISIBLE = 120;

    const onMove = (e: PointerEvent) => {
      if (!card || !startRect) return;

      // The card's position is (start + delta) because each move rewrites the
      // margin absolutely from the base rather than accumulating.
      const wantLeft = startRect.left + (e.clientX - startX);
      const wantTop = startRect.top + (e.clientY - startY);

      const left = Math.min(
        Math.max(wantLeft, KEEP_VISIBLE - startRect.width),
        window.innerWidth - KEEP_VISIBLE,
      );
      // Never above the top edge: the header is the only way to grab it back.
      const top = Math.min(Math.max(wantTop, 0), window.innerHeight - 40);

      card.style.marginLeft = `${baseLeft + (left - startRect.left)}px`;
      card.style.marginTop = `${baseTop + (top - startRect.top)}px`;
    };

    const onUp = () => {
      card = null;
      startRect = null;
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", onMove);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target?.closest) return;

      const handle = target.closest<HTMLElement>("[data-drag-handle], .modal-header");
      if (!handle) return;

      // A header holds the close button, tabs and tooltips. Dragging must not
      // swallow their clicks, and text in the title should stay selectable.
      if (target.closest("button, a, input, textarea, select, [role='button'], [role='tab']")) return;

      const found =
        handle.closest<HTMLElement>("[data-movable], .modal") ?? handle.parentElement;
      if (!found) return;

      card = found;
      startRect = card.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      const cs = getComputedStyle(card);
      baseLeft = Number.parseFloat(cs.marginLeft) || 0;
      baseTop = Number.parseFloat(cs.marginTop) || 0;

      // Without this a drag across the dialog selects its label text.
      document.body.style.userSelect = "none";
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp, { once: true });
    };

    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove);
      document.body.style.userSelect = "";
    };
  }, []);
}
