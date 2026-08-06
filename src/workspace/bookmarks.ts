import { useSyncExternalStore } from "react";

/**
 * Shared workspace bookmarks — folders the user wants to jump back to.
 * Backed by localStorage, subscribed by the header (WorkspacePath) and
 * Settings → Project so both always show the same list.
 */

const LS_KEY = "huskv2.bookmarks";

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    /* localStorage is untrusted — an older build (or a hand-edited value) may
       have stored a different shape. Only string entries are valid paths. */
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

let bookmarks: string[] = load();
const subscribers = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(bookmarks));
  } catch {
    // ignore
  }
}

function emit(): void {
  for (const fn of subscribers) fn();
}

export function getBookmarks(): string[] {
  return bookmarks;
}

export function subscribeBookmarks(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function useBookmarks(): string[] {
  return useSyncExternalStore(subscribeBookmarks, getBookmarks);
}

export function addBookmark(path: string): void {
  if (!path || bookmarks.includes(path)) return;
  bookmarks = [...bookmarks, path];
  persist();
  emit();
}

export function removeBookmark(path: string): void {
  if (!bookmarks.includes(path)) return;
  bookmarks = bookmarks.filter((b) => b !== path);
  persist();
  emit();
}
