import { useEffect } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { pushClip } from "./store";

/** Poll the system clipboard and record new text into the history. */
export function useClipboardListener(): void {
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const t = await readText();
        if (alive && t) pushClip(t);
      } catch {
        // clipboard unavailable / empty / non-text
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
}
