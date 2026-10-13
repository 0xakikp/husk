import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { fmtShortcut, MOD_KEY } from "../lib/platform";
import { usePrefs } from "../settings/preferences";
import { buildTerminalTheme } from "../styles/terminalTheme";
import type { TerminalSessionStatus } from "./sessionLifecycle";
import { dismissTerminalWelcome, getTerminalWelcome, subscribeTerminalWelcome } from "./terminalWelcomeState";
import { buildWelcomeNameArt } from "./welcomeNameArt";
import "./TerminalWelcome.css";

/** App chrome, never written to xterm, the PTY, logs, or command history. */
export function TerminalWelcome({ leafId, restored, status, onDismiss, getRowHeight }: {
  leafId: number;
  restored: boolean;
  status: TerminalSessionStatus;
  onDismiss: () => void;
  getRowHeight?: () => number;
}) {
  const prefs = usePrefs();
  const welcome = useSyncExternalStore(
    (listener) => subscribeTerminalWelcome(leafId, listener),
    () => getTerminalWelcome(leafId),
  );
  const shown = prefs.terminalWelcomeEnabled && !restored && status.state === "ready" && !!welcome?.visible;
  const greetingRef = useRef<HTMLElement>(null);
  const [geometry, setGeometry] = useState({ height: 0, rowHeight: 16 });
  useLayoutEffect(() => {
    const node = greetingRef.current;
    if (!shown || !node) return;
    const measure = () => {
      const height = node.getBoundingClientRect().height;
      const rowHeight = getRowHeight?.() || (prefs.terminalFontSize || 13) * 1.2;
      setGeometry((old) => old.height === height && old.rowHeight === rowHeight ? old : { height, rowHeight });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [shown, getRowHeight, prefs.terminalFontSize]);
  const scrollPixels = (welcome?.scrollRows ?? 0) * geometry.rowHeight;
  useLayoutEffect(() => {
    if (shown && geometry.height > 0 && scrollPixels >= geometry.height) dismissTerminalWelcome(leafId);
  }, [shown, geometry.height, scrollPixels, leafId]);
  if (!shown || !welcome) return null;

  const { label, glyphs } = buildWelcomeNameArt(prefs.userName);
  const salutation = prefs.userName.trim() ? "Hi," : "Welcome to";
  const theme = buildTerminalTheme(prefs.terminalTheme, prefs.theme === "dark", false, prefs.accentColor);
  const style = {
    "--welcome-accent": theme.cursor,
    "--welcome-blue": theme.blue,
    "--welcome-magenta": theme.magenta,
    "--welcome-cyan": theme.cyan,
    "--welcome-mode-ink": prefs.theme === "light" ? "#171717" : "#ffffff",
    "--welcome-color-weight": prefs.theme === "light" ? "62%" : "90%",
    transform: scrollPixels ? `translateY(-${scrollPixels}px)` : undefined,
  } as CSSProperties;

  return <div className="terminal-welcome-slot" style={{ height: geometry.height > 0 ? Math.max(0, geometry.height - scrollPixels) : undefined }}>
    <section ref={greetingRef} className="terminal-welcome" style={style} aria-label={`${salutation} ${label}`}>
    <div className="terminal-welcome__identity" title={label}>
      <span className="terminal-welcome__salutation">{salutation}</span>
      {glyphs && <div className="terminal-welcome__art" aria-hidden="true">
        {glyphs.map((glyph, index) => <pre key={index} data-color={index % 4}>{glyph}</pre>)}
      </div>}
      <strong className="terminal-welcome__name" data-has-art={!!glyphs}>{label}</strong>
    </div>
    <div className="terminal-welcome__details">
      <div className="terminal-welcome__status">
        <span className="terminal-welcome__local">Local shell</span>
        {welcome.atPrompt && <span className="terminal-welcome__ready"><span aria-hidden="true">●</span> Ready</span>}
      </div>
      <div className="terminal-welcome__hints">
        <span><kbd>{fmtShortcut(MOD_KEY, "K")}</kbd> Search</span>
        <span><kbd>Ctrl+R</kbd> History</span>
      </div>
    </div>
    <button
      type="button"
      className="terminal-welcome__dismiss"
      tabIndex={scrollPixels ? -1 : 0}
      aria-label="Dismiss terminal welcome"
      title="Dismiss welcome · disable for new terminals in Settings → Workspace → terminal"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); dismissTerminalWelcome(leafId); onDismiss(); }}
    >×</button>
  </section></div>;
}
