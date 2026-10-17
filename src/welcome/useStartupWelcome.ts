import { useCallback, useState } from "react";
import { getPrefs, setPrefs } from "../settings/preferences";

/** Native preferences are hydrated before App mounts. Decide once per main-app
 * mount, not on preference updates, terminal creation, focus, or waking up. */
export function useStartupWelcome() {
  const [isOpen, setOpen] = useState(() => {
    const prefs = getPrefs();
    return !prefs.hasSeenWelcome || prefs.showWelcomeOnStartup;
  });
  const show = useCallback(() => setOpen(true), []);
  const dismiss = useCallback(() => {
    setPrefs({ hasSeenWelcome: true });
    setOpen(false);
  }, []);
  return { isOpen, show, dismiss };
}
