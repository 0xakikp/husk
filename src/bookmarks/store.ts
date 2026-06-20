export type Bookmark = {
  id: string;
  type: "directory" | "file" | "command";
  label: string;
  path?: string;
  command?: string;
  createdAt: number;
};

const LS_KEY = "huskv2.bookmarks";

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
