import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/** Open the standalone settings window, or focus it if already open. */
export async function openSettingsWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("settings");
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow("settings", {
    url: "index.html?view=settings",
    title: "Settings — huskv2",
    width: 780,
    height: 640,
    resizable: true,
  });
  win.once("tauri://error", (e) => console.error("settings window:", e));
}
