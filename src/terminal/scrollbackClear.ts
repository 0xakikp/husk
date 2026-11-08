import type { IDisposable, Terminal } from "@xterm/xterm";

/** Keep ordinary shell clears in scrollback without rewriting the PTY stream.
 * Install before other J observers: xterm tries the newest parser hook first,
 * and our normal-buffer ED3 hook intentionally consumes that sequence.
 *
 * This is a screen-clear policy, not durable history. The configured scrollback
 * limit still applies; explicit term.clear()/reset() remain destructive.
 */
export function installScrollbackClearPolicy(term: Terminal): IDisposable {
  const previousScrollOnErase = term.options.scrollOnEraseInDisplay;
  let normalRegion = { top: 1, bottom: term.rows };
  let disposed = false;
  const resetNormalRegion = () => { normalRegion = { top: 1, bottom: term.rows }; };

  // No public API identifies every normal-buffer TUI. Preserve standard erase
  // semantics when explicit screen-oriented modes/margins provide evidence;
  // application cursor/keypad modes alone also occur at ordinary shell prompts.
  const preserveScreen = () => term.buffer.active.type === "normal"
    && term.modes.mouseTrackingMode === "none" && !term.modes.originMode
    && normalRegion.top === 1 && normalRegion.bottom === term.rows;

  term.options.scrollOnEraseInDisplay = true;
  const listeners = [
    term.parser.registerCsiHandler({ final: "J" }, params => {
      if (params[0] === 2) term.options.scrollOnEraseInDisplay = preserveScreen();
      // `clear` commonly emits ED3 in addition to home + ED2. Its ordinary
      // screen-clear operation must not remove the output ED2 just preserved.
      return params[0] === 3 && term.buffer.active.type === "normal";
    }),
    term.parser.registerCsiHandler({ prefix: "?", final: "J" }, params => {
      // DEC selective erase must continue respecting protected cells. xterm's
      // scroll-on-erase path is not selective, so do not enable it here.
      if (params[0] === 2) term.options.scrollOnEraseInDisplay = false;
      return false;
    }),
    term.parser.registerCsiHandler({ final: "r" }, params => {
      if (term.buffer.active.type !== "normal") return false;
      const top = typeof params[0] === "number" ? params[0] || 1 : 1;
      const requestedBottom = typeof params[1] === "number" ? params[1] : 0;
      const bottom = !requestedBottom || requestedBottom > term.rows ? term.rows : requestedBottom;
      // Match xterm's validity rule; invalid margins leave the old region alone.
      if (bottom > top) normalRegion = { top, bottom };
      return false;
    }),
    term.parser.registerCsiHandler({ intermediates: "!", final: "p" }, () => {
      if (term.buffer.active.type === "normal") resetNormalRegion();
      return false;
    }),
    term.parser.registerEscHandler({ final: "c" }, () => {
      resetNormalRegion();
      return false;
    }),
    // xterm resets its scrolling margins when the buffer is resized.
    term.onResize(resetNormalRegion),
  ];

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const listener of listeners) listener.dispose();
      term.options.scrollOnEraseInDisplay = previousScrollOnErase;
    },
  };
}
