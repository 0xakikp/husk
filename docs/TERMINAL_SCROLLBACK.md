# Terminal scrollback regression checks

Husk keeps the xterm buffer across tab switches, React remounts, and ordinary wake/health checks. It must not resize hidden, detached or transiently collapsed hosts. A tiny resize is not harmless: xterm can reflow hundreds of wide lines into thousands of narrow lines, exceed the configured history limit, and permanently trim the old output. Expanding again cannot recover it.

All automatic fits now require a visible, connected container and a valid grid of at least 20 columns by 3 rows. Smaller panes retain the previous grid until there is usable space again. Rejected dimensions are not cached or sent to the PTY; accepted dimensions are measured once, then applied through the prompt tracker. This does not clear, restart, or send keystrokes to the shell. Normal resizing still respects the user's configured history limit.

Automated coverage in `src/terminal/registry.receipts.test.ts` uses real xterm buffers and a mocked native transport. It writes 100 numbered lines, scrolls up, simulates tiny wake measurements and subsequent valid geometry, and verifies that history, scrollability, prompt safety and native resize dimensions remain correct. It also tests hidden/detached hosts and invalid dimensions.

## Desktop smoke check

1. In a disposable local shell, run `for i in $(seq 1 100); do printf 'HISTORY-%03d %090d\n' "$i" 0; done`. Scroll up and note the first line.
2. Switch tabs, open/collapse the sidebar and AI panel, resize/split the workspace, minimize/restore the window, then check that earlier numbered lines are still accessible.
3. Lock/unlock the laptop and sleep/wake it. Check scrolling before typing, then run a harmless command and check again. Repeat while scrolled to the bottom and while reading older output.
4. With an empty prompt, open Ctrl+R and stage a command after resizing. It should stage without executing; a typed draft must still be protected.

Physical sleep/wake is not simulated by unit tests. History already discarded cannot be recovered by this fix. Intentional `clear`/reset sequences, closing a terminal/app, and exceeding the configured scrollback limit remain separate causes of missing history. This is not persistent scrollback storage across app restarts.
