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
  onBrowserLoad,
  onBrowserNav,
  type BrowserRect,
} from "./client";
import "./BrowserPanel.css";

let nextBrowserInstanceId = 0;
const STORAGE_KEY = "husk.browser.url";
const DEFAULT_URL = "https://www.google.com";

type BrowserPhase = "connecting" | "loading" | "ready" | "error";

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, "") || "The embedded browser could not complete that action.";
}

function hostName(value: string): string {
  try {
    return new URL(value).host || "web";
  } catch {
    return "web";
  }
}

/**
 * Embedded browser panel. The visible web page is a native child webview,
 * parked over `browser-viewport`. React owns the chrome and error states;
 * Rust owns navigation and keeps the child view in the exact same rectangle.
 */
export function BrowserPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [instanceId] = useState(() => ++nextBrowserInstanceId);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const createdRef = useRef<string | null>(null);
  const initialUrlRef = useRef(localStorage.getItem(STORAGE_KEY) || DEFAULT_URL);
  const lastBoundsRef = useRef("");
  const visibleRef = useRef(visible);
  const [url, setUrl] = useState(initialUrlRef.current);
  const [input, setInput] = useState(initialUrlRef.current);
  const [phase, setPhase] = useState<BrowserPhase>("connecting");
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [readyLabel, setReadyLabel] = useState<string | null>(null);
  // A retry or rapid close/reopen must never let an old asynchronous create
  // close the new child view. Each attempt owns a distinct native label.
  const label = `husk-browser-${instanceId}-${attempt}`;
  const labelRef = useRef(label);
  labelRef.current = label;

  visibleRef.current = visible;

  const rect = useCallback((): BrowserRect | null => {
    const el = viewportRef.current;
    if (!el) return null;
    const bounds = el.getBoundingClientRect();
    if (bounds.width < 2 || bounds.height < 2) return null;
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }, []);

  const syncBounds = useCallback(() => {
    const bounds = rect();
    if (!bounds || createdRef.current !== label) return;
    const key = `${Math.round(bounds.x)}:${Math.round(bounds.y)}:${Math.round(bounds.width)}:${Math.round(bounds.height)}`;
    if (key === lastBoundsRef.current) return;
    lastBoundsRef.current = key;
    void browserSetBounds(label, bounds).catch(() => {
      if (createdRef.current === label) lastBoundsRef.current = "";
      // A close can race a final layout pass. The next successful creation
      // resets this key and owns positioning again.
    });
  }, [label, rect]);

  // Receive browser events before creating the child view, so redirects and
  // fast initial loads cannot leave the address bar or loading indicator stale.
  useEffect(() => {
    const nav = onBrowserNav((label, next) => {
      if (label !== labelRef.current) return;
      initialUrlRef.current = next;
      setUrl(next);
      setInput(next);
      setFailure(null);
      setPhase("loading");
      localStorage.setItem(STORAGE_KEY, next);
    });
    const load = onBrowserLoad((label, next, nextPhase) => {
      if (label !== labelRef.current) return;
      if (nextPhase === "started") {
        setPhase("loading");
        return;
      }
      initialUrlRef.current = next;
      setUrl(next);
      setInput(next);
      setPhase("ready");
      localStorage.setItem(STORAGE_KEY, next);
    });
    return () => {
      void Promise.all([nav, load]).then((listeners) => listeners.forEach((unlisten) => unlisten()));
    };
  }, []);

  // Each create attempt owns and closes its native child, including when the
  // panel disappears before the asynchronous create command returns.
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const create = async () => {
      if (cancelled) return;
      const bounds = rect();
      if (!bounds) {
        // A hidden or zero-sized workspace must not spin at 60 fps waiting
        // for layout. A later visible layout will be picked up on retry.
        retryTimer = setTimeout(() => void create(), 250);
        return;
      }
      setFailure(null);
      setPhase("connecting");
      try {
        await browserCreate(label, initialUrlRef.current, bounds);
        if (cancelled) {
          await browserClose(label).catch(() => undefined);
          return;
        }
        createdRef.current = label;
        setReadyLabel(label);
        lastBoundsRef.current = "";
        syncBounds();
        await browserSetVisible(label, visibleRef.current);
        if (!cancelled) setPhase("loading");
      } catch (error) {
        if (!cancelled) {
          if (createdRef.current === label) createdRef.current = null;
          void browserClose(label).catch(() => undefined);
          setPhase("error");
          setFailure(errorText(error));
        }
      }
    };

    frame = requestAnimationFrame(() => void create());
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(retryTimer);
      const wasCreated = createdRef.current === label;
      if (wasCreated) createdRef.current = null;
      lastBoundsRef.current = "";
      if (wasCreated) void browserClose(label);
    };
  }, [label, rect, syncBounds]);

  // Position can change without a ResizeObserver callback when a neighbouring
  // workspace panel moves. Compare rectangles while the browser is visible,
  // but only invoke native code when a value actually changed.
  useEffect(() => {
    if (!visible || readyLabel !== label || createdRef.current !== label) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const track = () => {
      syncBounds();
      timer = setTimeout(track, 120);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncBounds);
    if (viewportRef.current) observer?.observe(viewportRef.current);
    window.addEventListener("resize", syncBounds);
    track();
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [label, readyLabel, syncBounds, visible]);

  useEffect(() => {
    if (createdRef.current !== label) return;
    void browserSetVisible(label, visible).catch((error) => {
      if (visible) {
        setPhase("error");
        setFailure(errorText(error));
      }
    });
    if (visible) {
      lastBoundsRef.current = "";
      requestAnimationFrame(syncBounds);
    }
  }, [label, readyLabel, syncBounds, visible]);

  useEffect(() => {
    const focusLocation = (event: KeyboardEvent) => {
      if (!visible || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "l") return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", focusLocation);
    return () => window.removeEventListener("keydown", focusLocation);
  }, [visible]);

  const navigate = useCallback(async (target: string) => {
    const next = target.trim();
    if (!next) return;
    initialUrlRef.current = next;
    setFailure(null);
    setPhase("loading");
    if (createdRef.current !== label) {
      setAttempt((value) => value + 1);
      return;
    }
    try {
      await browserNavigate(label, next);
    } catch (error) {
      setPhase("error");
      setFailure(errorText(error));
    }
  }, [label]);

  // Utilities such as Ports can send a local endpoint straight to Husk's
  // browser. The caller also persists the URL, so this event matters only
  // when the browser panel is already mounted.
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const url = (event as CustomEvent<{ url?: unknown }>).detail?.url;
      if (typeof url === "string" && url.trim()) void navigate(url);
    };
    window.addEventListener("husk-browser-navigate", onNavigate);
    return () => window.removeEventListener("husk-browser-navigate", onNavigate);
  }, [navigate]);

  const history = useCallback(async (action: "back" | "forward" | "reload") => {
    if (createdRef.current !== label) return;
    setFailure(null);
    setPhase("loading");
    try {
      await browserGo(label, action);
    } catch (error) {
      setPhase("error");
      setFailure(errorText(error));
    }
  }, [label]);

  const retry = useCallback(async () => {
    setFailure(null);
    setPhase("connecting");
    if (createdRef.current === label) {
      await browserClose(label).catch(() => undefined);
      createdRef.current = null;
      lastBoundsRef.current = "";
    }
    setAttempt((value) => value + 1);
  }, [label]);

  const openExternal = useCallback(async () => {
    try {
      await openUrl(url);
    } catch (error) {
      setFailure(errorText(error));
    }
  }, [url]);

  const statusLabel = phase === "connecting" ? "Opening browser" : phase === "loading" ? "Loading page" : phase === "error" ? "Needs attention" : hostName(url);
  const iconButton = "browser-icon-button";

  return (
    <div className="browser-panel">
      <header className="browser-chrome">
        <div className="browser-brand" title="Embedded browser" aria-hidden="true">
          <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.8} />
        </div>
        <div className="browser-nav-group" aria-label="Navigation">
          <button type="button" className={iconButton} title="Back" aria-label="Back" onClick={() => void history("back")}>
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
          </button>
          <button type="button" className={iconButton} title="Forward" aria-label="Forward" onClick={() => void history("forward")}>
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={1.75} />
          </button>
          <button type="button" className={`${iconButton}${phase === "loading" ? " is-loading" : ""}`} title="Reload" aria-label="Reload" onClick={() => void history("reload")}>
            <HugeiconsIcon icon={RefreshIcon} size={13} strokeWidth={1.75} />
          </button>
        </div>
        <form className="browser-location" onSubmit={(event) => { event.preventDefault(); void navigate(input); }}>
          <span className={`browser-location-dot is-${phase}`} aria-hidden="true" />
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder="Search the web or enter a URL"
            aria-label="Search or enter a web address"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          <kbd>⌘L</kbd>
        </form>
        <span className={`browser-page-state is-${phase}`} title={statusLabel}>{statusLabel}</span>
        <div className="browser-action-group">
          <button type="button" className={iconButton} title="Open in system browser" aria-label="Open in system browser" onClick={() => void openExternal()}>
            <HugeiconsIcon icon={LinkSquare01Icon} size={13} strokeWidth={1.75} />
          </button>
          <button type="button" className={`${iconButton} is-close`} title="Close browser" aria-label="Close browser" onClick={onClose}>
            <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.75} />
          </button>
        </div>
        <span className={`browser-load-indicator is-${phase}`} aria-hidden="true" />
      </header>

      {failure ? (
        <div className="browser-alert" role="alert">
          <span>Browser notice</span>
          <p>{failure}</p>
          <button type="button" onClick={() => void retry()}>try again</button>
          <button type="button" onClick={() => void openExternal()}>open externally ↗</button>
        </div>
      ) : null}

      <div ref={viewportRef} className="browser-viewport">
        {phase === "connecting" ? <div className="browser-placeholder" aria-live="polite"><span /><p>Opening browser…</p></div> : null}
        {failure ? (
          <div className="browser-error" role="alert">
            <span>Browser needs attention</span>
            <p>{failure}</p>
            <div><button type="button" onClick={() => void retry()}>try again</button><button type="button" onClick={() => void openExternal()}>open externally ↗</button></div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
