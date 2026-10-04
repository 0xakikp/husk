# Cmd+K launcher

The launcher uses Husk's colourful source badges, rounded search capsule, accent focus glow, and spring entrance, scoped to `CommandPalette.css`; other dialogs keep their existing styles. Reduced-motion preferences disable animation. Source filters are tucked behind Sources to keep the default header uncluttered, and preserve the typed query. Chats, Wallpaper, 2FA, and previously unknown source groups remain reachable. Recent results show newest-first, without duplicating rows elsewhere.

## Navigation

- Arrow keys or Tab/Shift+Tab select results. Enter uses the action named in the footer.
- Cmd/Ctrl+Enter uses the selected result's secondary action; Cmd/Ctrl+. opens its action menu.
- Sources or Alt+S opens the source filters. Left/Right moves between filters; Enter selects one and returns to search. Escape collapses the filters and returns to the search field.
- Alt+Up recalls the newest available command first; Alt+Down moves back toward the empty query.
- Show more preserves the query and opens that source, or expands a mixed-source group in place.
- The footer exposes the selected full path/destination and action labels. Confirmations show the exact action and default focus to Cancel. Async failures stay visible and do not record a successful use.

## Terminal safety

Launcher staging captures the terminal when the palette opens and rechecks the active leaf, PTY, directory, host, connection generation, and verified empty prompt before writing. Changing targets or losing prompt readiness rejects the action. Generated shell arguments are quoted. Staging never adds Enter; executing the staged command remains the user's decision.

Multiline, control-character, and over-2,000-character clipboard entries offer Copy only. The staging boundary also validates all other command proposals. Reviewed leading/trailing whitespace is preserved for launcher commands, including intentional leading spaces used for shell-history exclusion. No staging fallback types into an unverified prompt.

Close tab, Kill job, and Delete chat require explicit confirmation. Merely selecting a result or opening a confirmation does not perform those actions. Workflow execution continues through its existing review flow.

## Search boundaries

Workspace-file caches are keyed by root and notify open launchers when refreshed. Old-root file/content results are hidden immediately. Code indexing has one scan per active root/scope lifetime, independent of changing query text; cancelled scans cannot replace the active snapshot. Code hits resolve relative paths against their captured root and preserve the index's relevance scores.

Grep results discard stale completions; this does not terminate an already-running native subprocess, which retains its existing timeout. Existing bounds remain: 200 notes, 3,000 workspace filenames, 50 grep hits, and 30 ranked code hits. Show more expands loaded results, not these source limits. Opening local results never inherits an SSH host from the Remotes sidebar. If the editor already has the same path open from another host, the launcher asks the user to close that tab first.

## Desktop release checks

1. Search for a file, note, chat, wallpaper, and 2FA account; confirm source filters, contextual actions, and full paths. Do not expose generated codes in screenshots or logs.
2. Switch between two workspace folders while file, grep, and code searches load. Confirm only the selected root's results appear and opening a code hit reaches the expected line.
3. In a disposable local shell, stage a harmless one-line command. Confirm the preview identifies the target and Enter is not sent. Repeat with a busy prompt, existing draft, changed directory, and changed terminal: staging should fail without writing.
4. Copy multiline text from clipboard history. Confirm no terminal-staging action is offered and copied text remains unchanged.
5. Exercise filters and actions entirely by keyboard, including Cancel/Escape, rapid repeated Enter, and an intentionally failed action. Confirm no duplicate action or result activation from a filter button.
6. Check light/dark themes, long paths, long confirmations, short windows, and focus visibility in the desktop app. DOM tests do not verify pixel-level rendering or native shell integration.

Automated coverage lives in `src/command-palette/*.test.ts`, alongside the existing `src/terminal/stageScreenCommand.test.ts`. All terminal and application I/O in these tests is mocked.
