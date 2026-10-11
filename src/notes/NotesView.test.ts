// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("./store", () => ({
  ensureNotesDirectory: vi.fn(async () => "/notes"),
  loadNotesTree: vi.fn(async () => [{ name: "Test.md", path: "/notes/Test.md", isDirectory: false }]),
  getLastViewedNote: () => null, getAllTemplates: () => [], getPinnedNotes: () => [],
  getRecentNoteEntries: () => [], isNotePinned: () => false, isNoteFile: () => true,
  searchNotesContent: vi.fn(async () => []),
}));
vi.mock("./notesAi", () => ({ expandVaultLensQuery: vi.fn(async () => []), organizeNoteWithAi: vi.fn() }));
vi.mock("./NoteOrganizeReview", () => ({ NoteOrganizeReview: () => null }));
vi.mock("../fs", () => ({ readFile: vi.fn(async () => "") }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("../explorer/iconResolver", () => ({ folderIconUrl: () => "" }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));

import { NotesView } from "./NotesView";
import { searchNotesContent } from "./store";
import { expandVaultLensQuery } from "./notesAi";

let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const input = () => host.querySelector<HTMLInputElement>(".notes-search-input")!;
const lens = () => host.querySelector<HTMLButtonElement>(".notes-search-lens")!;
const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-label="Search notes"]')!;
async function openSearch() {
  await act(async () => root.render(createElement(NotesView, { inline: true })));
  await act(async () => toggle().click());
}

it("keeps empty search open when keyboard focus moves to Lens", async () => {
  await openSearch();
  expect(document.activeElement).toBe(input());
  expect(input().getAttribute("aria-label")).toBe("Search notes");
  await act(async () => lens().focus());
  expect(input()).not.toBeNull();
  expect(document.activeElement).toBe(lens());
  expect(lens().getAttribute("aria-pressed")).toBe("false");
  await act(async () => lens().click());
  expect(lens().getAttribute("aria-pressed")).toBe("true");
  expect(input().placeholder).toBe("Ask Vault Lens…");
  expect(expandVaultLensQuery).not.toHaveBeenCalled();
  await act(async () => lens().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(input()).toBeNull();
  expect(document.activeElement).toBe(toggle());
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
});

it("closes empty search only when focus leaves the search group", async () => {
  await openSearch();
  await act(async () => host.querySelector<HTMLButtonElement>('button[title="New note"]')!.focus());
  expect(input()).toBeNull();
});

it("keeps a typed query, and refocuses it from the header search button", async () => {
  await openSearch();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), "deployment");
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(searchNotesContent).toHaveBeenCalledWith("/notes", "deployment");
  await act(async () => toggle().focus());
  expect(input().value).toBe("deployment");
  await act(async () => toggle().click());
  expect(document.activeElement).toBe(input());
  expect(expandVaultLensQuery).not.toHaveBeenCalled();
});

it("resets native input chrome and only suppresses the inner input focus ring", () => {
  // DOM tests do not lay out CSS; protect the scoped reset and focus contract.
  const css = readFileSync(resolve("src/notes/NotesView.css"), "utf8");
  const field = css.match(/\.notes-search-field\s*\{([^}]+)\}/)![1];
  const control = css.match(/\.notes-search-input\s*\{([^}]+)\}/)![1];
  expect(field).toContain("height: 32px");
  expect(field).toContain("box-sizing: border-box");
  expect(control).toContain("border: 0");
  expect(control).toContain("min-width: 0");
  expect(control).toContain("appearance: none");
  expect(css).toMatch(/\.notes-search-input:focus-visible\s*\{\s*box-shadow: none !important/);
  expect(css).toMatch(/\.notes-search-field:focus-within\s*\{\s*border-color:/);
  expect(css).toMatch(/\.notes-search-lens\s*\{[^}]*flex-shrink: 0;[^}]*border: 1px solid transparent/);
  expect(css).not.toMatch(/\.notes-search-lens:focus-visible|\*:focus-visible/);
});
