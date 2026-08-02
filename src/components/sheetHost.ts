/** The id carried by the sidebar panel, so sheets can portal into it. */
export const SHEET_HOST_ID = "husk-sidebar-panel";

/**
 * Where a sidebar-launched form should render.
 *
 * Forms opened from a sidebar view — new note, new bookmark, new workflow —
 * used to portal to `document.body` and appear as a card floating in the middle
 * of the window, disconnected from the list that opened them. They now portal
 * into the sidebar panel itself and fill it, so drilling into a form reads as
 * part of the sidebar rather than as the app being interrupted.
 *
 * Falls back to `document.body` when the sidebar is closed or the view is
 * rendered somewhere else, in which case `.sidebar-sheet` behaves as a normal
 * centred overlay.
 */
export function sheetHost(): HTMLElement {
  return document.getElementById(SHEET_HOST_ID) ?? document.body;
}
