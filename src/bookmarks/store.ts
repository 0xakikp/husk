export type Bookmark = {
  id: string;
  type: "directory" | "file" | "command";
  label: string;
  path?: string;
  command?: string;
  createdAt: number;
  pinned?: boolean;
};

const LS_KEY = "huskv2.bookmarks";
const MAX_PINNED = 5;

let bookmarks: Bookmark[] = [];

try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) bookmarks = JSON.parse(raw);
} catch {
  bookmarks = [];
}

const subscribers = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(bookmarks));
  } catch {}
  for (const fn of subscribers) fn();
}

export function getBookmarks(): Bookmark[] {
  return [...bookmarks];
}

export function getPinnedBookmarks(): Bookmark[] {
  return bookmarks.filter((b) => b.pinned).slice(0, MAX_PINNED);
}

export function addBookmark(b: Omit<Bookmark, "id" | "createdAt">): Bookmark {
  const newB: Bookmark = {
    ...b,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  bookmarks.push(newB);
  save();
  return newB;
}

export function removeBookmark(id: string): boolean {
  const idx = bookmarks.findIndex((b) => b.id === id);
  if (idx === -1) return false;
  bookmarks.splice(idx, 1);
  save();
  return true;
}

export function updateBookmark(
  id: string,
  patch: Partial<Omit<Bookmark, "id" | "createdAt">>
): boolean {
  const b = bookmarks.find((b) => b.id === id);
  if (!b) return false;
  Object.assign(b, patch);
  save();
  return true;
}

export function pinBookmark(id: string): boolean {
  const pinnedCount = bookmarks.filter((b) => b.pinned).length;
  if (pinnedCount >= MAX_PINNED) return false;
  return updateBookmark(id, { pinned: true });
}

export function unpinBookmark(id: string): boolean {
  return updateBookmark(id, { pinned: false });
}

export function toggleBookmarkPin(id: string): boolean {
  const b = bookmarks.find((b) => b.id === id);
  if (!b) return false;
  if (b.pinned) return unpinBookmark(id);
  return pinBookmark(id);
}

export function useBookmarks(): Bookmark[] {
  const [snapshot, setSnapshot] = useState<Bookmark[]>(() => [...bookmarks]);
  useEffect(() => {
    const fn = () => setSnapshot([...bookmarks]);
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);
  return snapshot;
}

import { useState, useEffect } from "react";
