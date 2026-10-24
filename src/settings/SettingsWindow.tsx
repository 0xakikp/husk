import { lazy, Suspense, useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ToastContainer, toast } from "../toast";
import { flushNativeConfig, retryNativeConfig } from "./nativeConfig";
import { confirmSettingsNavigation } from "./settingsDrafts";
import { useWindowChrome } from "./windowChrome";

const SettingsPage = lazy(() => import("./SettingsPage").then((module) => ({ default: module.SettingsPage })));

export function SettingsWindow() {
  useWindowChrome();
  const closing = useRef(false);
  const mounted = useRef(true);

  const close = useCallback(async (checkDrafts: boolean, retry = false) => {
    if (closing.current || !mounted.current) return;
    closing.current = true;
    try {
      if (checkDrafts && !await confirmSettingsNavigation()) return;
      await (retry ? retryNativeConfig() : flushNativeConfig());
      if (mounted.current) await getCurrentWindow().destroy();
    } catch {
      if (mounted.current) toast({
        variant: "error",
        title: "Settings stayed open",
        message: "Your changes could not be saved. Retry saving before closing.",
        duration: 0,
        action: { label: "Retry and close", onClick: () => { void close(true, true); } },
      });
    } finally {
      closing.current = false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let focusRevision = 0;
    const unlisten: (() => void)[] = [];
    // StrictMode may unmount while Tauri is still registering a listener. In
    // that case, dispose the late registration instead of leaking it.
    const retain = (promise: Promise<() => void>) => {
      void promise.then((stop) => {
        if (disposed) stop();
        else unlisten.push(stop);
      }).catch(() => {
        if (!disposed) console.warn("A Settings window listener could not be registered.");
      });
    };
    try {
      const win = getCurrentWindow();
      retain(win.listen("tauri://focus", () => {
        ++focusRevision;
        if (!disposed) document.documentElement.classList.remove("settings-unfocused");
      }));
      retain(win.listen("tauri://blur", () => {
        ++focusRevision;
        if (!disposed) document.documentElement.classList.add("settings-unfocused");
      }));
      retain(win.onCloseRequested((event) => {
        if (disposed) return;
        event.preventDefault();
        return close(true);
      }));
      void win.isFocused().then((focused) => {
        if (!disposed && focusRevision === 0) document.documentElement.classList.toggle("settings-unfocused", !focused);
      }).catch(() => undefined);
    } catch {
      console.warn("Settings window integration is unavailable.");
    }
    return () => {
      disposed = true;
      mounted.current = false;
      for (const stop of unlisten) stop();
      document.documentElement.classList.remove("settings-unfocused");
    };
  }, [close]);

  return <>
    <Suspense fallback={<div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">Loading settings…</div>}>
      {/* SettingsPage already confirms drafts for its own close action. */}
      <SettingsPage onClose={() => { void close(false); }} />
    </Suspense>
    <ToastContainer />
  </>;
}
