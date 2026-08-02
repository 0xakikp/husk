import { createContext, useContext } from "react";

/** The id carried by the sidebar panel, so sheets can portal into it. */
export const SHEET_HOST_ID = "husk-sidebar-panel";

/**
 * True anywhere inside a sidebar view.
 *
 * `Modal` reads this to decide whether it is a window-level dialog or a sheet
 * that fills the sidebar panel. Context rather than a prop because the dialogs
 * that need it are nested — RemotesView renders ConnectionDialog, which renders
 * the Modal — and threading a flag through every layer would mean touching each
 * one and remembering to do it for the next. React context crosses portals, so
 * this still reaches a Modal that portals out to the panel.
 *
 * Dialogs mounted from App (clipboard, shortcuts, TOTP, jobs) are outside this
 * provider and stay centred, which is right: they are not about the sidebar.
 */
export const SidebarSheetContext = createContext(false);

export function useIsSidebarSheet(): boolean {
  return useContext(SidebarSheetContext);
}

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
