import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReviewIndicatorItem, ReviewItemKind } from "./reviewIndicatorItems";

const REVIEW_EVENT = "husk:reveal-review";
type ReviewNavigation = { sessionId: string; id: string; kind: ReviewItemKind };

function findReviewCard(root: HTMLElement, item: Pick<ReviewNavigation, "id" | "kind" | "sessionId">) {
  return [...root.querySelectorAll<HTMLElement>("[data-review-item]")].find((card) =>
    card.dataset.reviewItem === item.id && card.dataset.reviewKind === item.kind && card.dataset.reviewSession === item.sessionId,
  );
}

function focusReviewCard(card: HTMLElement | undefined) {
  if (!card) return;
  card.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  // Focus the card itself, never an Apply/Run control. Enter after navigation
  // must not accidentally approve an action.
  card.focus({ preventScroll: true });
}

/** Navigate only within the originating composer. The event can open a review
 * section; it carries no execution permission and never clicks a button. */
export function revealReviewItem(root: HTMLElement, sessionId: string, item: ReviewIndicatorItem): void {
  const detail = { sessionId, id: item.id, kind: item.kind };
  root.dispatchEvent(new CustomEvent<ReviewNavigation>(REVIEW_EVENT, { detail }));
  focusReviewCard(findReviewCard(root, detail));
}

export function useReviewNavigation(sessionId: string | undefined, kind: ReviewItemKind, itemIds: readonly string[]) {
  const reviewRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const idsRef = useRef(itemIds);
  idsRef.current = itemIds;

  useEffect(() => {
    const root = reviewRef.current?.closest<HTMLElement>(".composer-panel");
    if (!root || !sessionId) return;
    const reveal = (event: Event) => {
      const detail = (event as CustomEvent<ReviewNavigation>).detail;
      if (!detail || detail.sessionId !== sessionId || detail.kind !== kind || !idsRef.current.includes(detail.id)) return;
      setExpanded(true);
      setRequestedId(detail.id);
    };
    root.addEventListener(REVIEW_EVENT, reveal);
    return () => root.removeEventListener(REVIEW_EVENT, reveal);
  }, [kind, sessionId, itemIds.length > 0]);

  useLayoutEffect(() => {
    if (!expanded || !requestedId || !sessionId || !reviewRef.current) return;
    focusReviewCard(findReviewCard(reviewRef.current, { sessionId, kind, id: requestedId }));
    setRequestedId(null);
  }, [expanded, kind, requestedId, sessionId]);

  return { reviewRef, expanded, setExpanded };
}
