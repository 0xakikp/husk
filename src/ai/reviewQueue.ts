import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

/** Queue APIs return defensive copies. Cache equal snapshots for React, while
 * computing session selection synchronously on the first render after a switch.
 * Unscoped actions are never presented as approvals belonging to another chat. */
export function useSessionReviewQueue<T extends { sessionId?: string }>(
  read: () => T[],
  subscribe: (listener: () => void) => () => void,
  sessionId?: string,
): T[] {
  const snapshot = useMemo(() => {
    let cached: T[] = [];
    return () => {
      const next = read().filter((item) => sessionId === undefined || item.sessionId === sessionId);
      if (cached.length !== next.length || cached.some((item, index) => item !== next[index])) cached = next;
      return cached;
    };
  }, [read, sessionId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Unmounting a review (including switching chats) stops the remaining Apply
 * All operations. An operation already committed is still reported normally. */
export function useReviewCancellation() {
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  return controller;
}
