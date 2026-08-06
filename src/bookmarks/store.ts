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

function fallbackId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `bookmark-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).filter(Boolean).pop() || path;
}

function isBookmarkType(value: unknown): value is Bookmark["type"] {
  return value === "directory" || value === "file" || value === "command";
}

function normaliseBookmarks(value: unknown): { bookmarks: Bookmark[]; changed: boolean } {
  if (!Array.isArray(value)) return { bookmarks: [], changed: value != null };

  const seen = new Set<string>();
  const result: Bookmark[] = [];
  let changed = false;

  for (const entry of value) {
    let bookmark: Bookmark | null = null;

    // Husk's earliest workspace picker stored only folder paths. Upgrade those
    // entries into regular directory bookmarks so every surface sees the same
    // item from now on.
    if (typeof entry === "string" && entry.trim()) {
      const path = entry.trim();
      bookmark = {
        id: fallbackId(),
        type: "directory",
        label: baseName(path),
        path,
        createdAt: Date.now(),
      };
      changed = true;
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const candidate = entry as Partial<Bookmark>;
      const legacyDirectory = !isBookmarkType(candidate.type) && typeof candidate.path === "string";
      const type = isBookmarkType(candidate.type)
        ? candidate.type
        : legacyDirectory
          ? "directory"
          : null;
      const target = type === "command" ? candidate.command : candidate.path;

      if (type && typeof target === "string" && target.trim()) {
        const validCurrentBookmark =
          isBookmarkType(candidate.type) &&
          typeof candidate.id === "string" &&
          candidate.id.length > 0 &&
          typeof candidate.label === "string" &&
          candidate.label.trim().length > 0 &&
          typeof candidate.createdAt === "number";
        bookmark = validCurrentBookmark
          ? candidate as Bookmark
          : {
              id: typeof candidate.id === "string" && candidate.id ? candidate.id : fallbackId(),
              type,
              label: typeof candidate.label === "string" && candidate.label.trim()
                ? candidate.label.trim()
                : type === "command" ? target.trim().slice(0, 40) : baseName(target.trim()),
              ...(type === "command" ? { command: target.trim() } : { path: target.trim() }),
              createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now(),
              ...(candidate.pinned ? { pinned: true } : {}),
            };
        changed ||= !validCurrentBookmark;
      } else {
        changed = true;
      }
    } else {
      changed = true;
    }

    if (!bookmark) continue;
    const target = bookmark.path ?? bookmark.command ?? "";
    const key = `${bookmark.type}\u0000${target}`;
    if (seen.has(key)) {
      changed = true;
      continue;
    }
    seen.add(key);
    result.push(bookmark);
  }

  return { bookmarks: result, changed };
}

let loaded: { bookmarks: Bookmark[]; changed: boolean } = { bookmarks: [], changed: false };
try {
  const raw = localStorage.getItem(LS_KEY);
  loaded = normaliseBookmarks(raw ? JSON.parse(raw) : []);
} catch {
  loaded = { bookmarks: [], changed: false };
}
let bookmarks = loaded.bookmarks;
const subscribers = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(bookmarks));
  } catch {}
  for (const fn of subscribers) fn();
}

// Persist the one-time migration before any view reads the list.
if (loaded.changed) save();

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

/** Replace bookmarks imported from cloud sync and notify every live consumer. */
export function replaceBookmarks(value: unknown): Bookmark[] {
  bookmarks = normaliseBookmarks(value).bookmarks;
  save();
  return getBookmarks();
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
