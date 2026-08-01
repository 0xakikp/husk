import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  RefreshIcon,
  Globe02Icon,
  LinkSquare01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  browserClose,
  browserCreate,
  browserGo,
  browserNavigate,
  browserSetBounds,
  browserSetVisible,
  onBrowserNav,
  type BrowserRect,
} from "./client";

const LABEL = "husk-browser";
const STORAGE_KEY = "husk.browser.url";
const DEFAULT_URL = "https://www.google.com";

/**
 * Embedded browser panel. The visible web page is a NATIVE child webview
 * (Tauri WebviewView) parked over the placeholder div — not a React element.
 * It floats above every React surface (dialogs, palette, other panels), so
 * the `visible` prop must be false whenever anything can cover this panel.
 */
export function BrowserPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const createdRef = useRef(false);
  const [url, setUrl] = useState(() => localStorage.getItem(STORAGE_KEY) || DEFAULT_URL);
  const [input, setInput] = useState(url);

  const rect = useCallback((): BrowserRect | null => {
    const el = hostRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, []);

  // Create the native webview once per mount and track the placeholder's rect.
  useEffect(() => {
    const el = hostRef.current;
    const r = rect();
    if (!el || !r) return;
    createdRef.current = true;
    void browserCreate(LABEL, url, r);

    const ro = new ResizeObserver(() => {
      const b = rect();
      if (b && createdRef.current) void browserSetBounds(LABEL, b);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      createdRef.current = false;
      void browserClose(LABEL);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the address bar in sync with real navigations (link clicks etc.).
  useEffect(() => {
    const unlisten = onBrowserNav((label, next) => {
      if (label !== LABEL) return;
      setUrl(next);
      setInput(next);
      localStorage.setItem(STORAGE_KEY, next);
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  // Park/show the native layer as React surfaces cover or reveal this panel.
  useEffect(() => {
    if (!createdRef.current) return;
    void browserSetVisible(LABEL, visible);
    if (visible) {
      const b = rect();
      if (b) void browserSetBounds(LABEL, b);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const go = (target: string) => {
    const t = target.trim();
    if (!t) return;
    void browserNavigate(LABEL, t);
  };

  const iconBtn =
    "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Chrome bar */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
        <HugeiconsIcon icon={Globe02Icon} size={13} strokeWidth={1.9} className="mx-1 shrink-0 text-accent" />
        <button type="button" className={iconBtn} title="Back" onClick={() => void browserGo(LABEL, "back")}>
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
        </button>
        <button type="button" className={iconBtn} title="Forward" onClick={() => void browserGo(LABEL, "forward")}>
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />
        </button>
        <button type="button" className={iconBtn} title="Reload" onClick={() => void browserGo(LABEL, "reload")}>
          <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={1.75} />
        </button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            go(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="h-7 w-full rounded-md border border-border/60 bg-muted/20 px-2.5 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-accent/60"
            placeholder="Search or enter URL"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </form>
        <button type="button" className={iconBtn} title="Open in system browser" onClick={() => void openUrl(url)}>
          <HugeiconsIcon icon={LinkSquare01Icon} size={13} strokeWidth={1.75} />
        </button>
        <button type="button" className={iconBtn} title="Close browser" onClick={onClose}>
          <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.75} />
        </button>
      </div>

      {/* Placeholder the native webview is parked over */}
      <div ref={hostRef} className="min-h-0 min-w-0 flex-1" />
    </div>
  );
}
