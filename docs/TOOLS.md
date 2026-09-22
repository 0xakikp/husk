# Tools and custom plugins

The sidebar **Tools** destination is a compact launcher grouped into Utilities (2FA Codes, Ports, Dev Tools) and Infrastructure (Kubernetes, Docker, Tailscale). Each row shows an icon and name; hover or keyboard-focus a row for its description. Custom plugin rows appear only after a folder is configured and contains definitions. Folder/setup information lives in **Tools options → Manage custom plugins…**, not in the launcher. Narrow sidebars keep 32px rail buttons and put excess destinations in **More**. Docker, Kubernetes, and Tailscale keep their parent Tools destination selected. Left/Right and Home/End navigate the rail; Enter/Space activate controls.

**Tools options → Check CLIs** checks local `kubectl` and `docker` executable presence only. The launcher shows **Unavailable** only for a missing CLI after a successful check; unchecked/present CLIs have no badge. A tooltip gives details, and failed checks show an error instead of marking every CLI missing. This does not establish cluster or Docker daemon connectivity. Those panels use Husk's local CLI configuration, not the active SSH terminal. Docker CLI configuration may itself point to a remote daemon. Tailscale is an API integration configured inside its panel, not a CLI installation check.

## Load a custom tool

1. Choose **Tools options → Manage custom plugins… → Choose folder**. Use **Back to tools** to return to the compact launcher.
2. Select a local folder containing JSON plugin definitions. Invalid files remain visible with an error. Unreadable folders have a retry action and are not reported as empty.
3. Open a plugin and review its exact command and local workspace path. Opening it does not run anything. **Run view locally** authorizes that command in that workspace for this open panel.
4. Refresh manually, or explicitly opt into the plugin's suggested auto-refresh interval. Switching views, changing workspace, reloading definitions, or closing the tool revokes the corresponding view consent. Hiding a tool/window pauses auto-refresh and invalidates in-flight results. Returning to a previously authorized visible tool resumes an opted-in timer; stale rows remain unavailable for actions until refreshed.
5. **Manage custom plugins… → Reload plugins** reloads definitions. **Clear folder selection** only clears the saved folder preference; it does not delete files. The launcher shows **Plugin setup · Needs attention** if definitions fail to load; open it for the full error and recovery controls.

Example `files.json`, using the macOS/Linux `ls` executable:

```json
{
  "name": "Workspace files",
  "description": "List entries and review a metadata command",
  "brand": "#4A90D9",
  "views": [
    {
      "title": "Files",
      "command": "ls -1",
      "format": "lines",
      "actions": [
        { "label": "File metadata", "command": "ls -ld -- '{Output}'" }
      ]
    }
  ]
}
```

Views support `lines`, whitespace-aligned `table` (header and cells separated by at least two whitespace characters), and `json` (objects with scalar fields or scalar rows). JSON is preferable when values contain whitespace. `columns` optionally selects exact JSON/table column names. Nested JSON fields are not exposed to actions. An optional `refresh` from 2 to 86,400 seconds only suggests an interval; it does not authorize polling.

## Execution and trust

Custom plugins are **not sandboxed extensions**. A view is an arbitrary local executable and can modify files, contact networks, launch processes, or affect services. Only run definitions from authors you trust. Husk does not send custom-tool data to AI automatically.

Commands use simple literal program-and-argument syntax, with single/double quotes for grouping. Pipes, redirects, shell expansions, globs, empty quoted arguments, and control characters are rejected rather than silently reinterpreted. Executables must be literal names/paths. Row actions insert `{Column}` values as shell-quoted literal arguments; missing fields are errors. Interpreter/dispatcher templates with row placeholders are rejected. Quoting is not a guarantee that a command is harmless: the selected program can interpret arguments as options or code. Always review the final command.

Row actions first open a frozen preview with **Copy command**, **Stage only**, and **Close preview**. The legacy `run: true` field is accepted for compatibility but never executes the action. Staging requires a verified local terminal in the same directory, an empty idle prompt, and the same terminal/connection identity at write time. SSH, changed targets, busy/unknown prompts, partial output, and stale data are rejected. Staging never presses Enter. Shell integration is needed to verify prompt state; when unavailable, copy and manually review instead.

Docker terminal actions and Ports' curl action also stage into verified local prompts instead of running immediately. Tailscale's **Stage SSH command** prepares a connection command in a local prompt. Check the terminal's CLI context/environment before executing: Husk's subprocess environment and your interactive shell environment may differ.

**Stop waiting** discards results and disables that view's auto-refresh; it is not immediate process cancellation. A command already started may keep running until its 20-second execution deadline (binary resolution can add up to 3 seconds). The native runner terminates/reaps the direct process at timeout and kills its isolated process group on Unix. Programs that deliberately detach/escape the process group are not contained; Windows cleanup covers the direct child. Timed-out or truncated native output is never used for row actions.

Limits: 100 JSON files per folder, 128 KiB per definition, 20 views, 20 actions per view, 64 columns, 8,000 UTF-8 bytes per authored command and cell, and 200 displayed rows. Native stdout and stderr are each capped at 256 KiB. Additional rows are clearly marked partial with actions disabled. Commands are never silently shortened. The shared terminal staging path has a stricter 2,000-character command limit. Plugin definitions remain on disk; the folder preference is saved in Husk settings, while execution consent and displayed rows are not persisted.

## Desktop release checks

- Switch light/dark themes and narrow/widen the rail. Verify Tools parent selection, More menu, tooltip readability, keyboard navigation, and full-size targets.
- Test no folder, empty folder, denied/missing folder, invalid JSON, oversized files, duplicate columns and unsafe templates. Switch folders while a load is pending; old results must not reappear. Reload a modified definition and verify renewed consent.
- Open a custom plugin without running it. No view command should execute. After consent, change views/workspace while a request is pending; no old rows or actions should carry over.
- Enable auto-refresh, then hide the panel/window. No new requests should start. Slow commands must not overlap within the open panel; refresh failures must show stale data, not a fabricated empty list.
- Preview an action containing spaces, quotes, or shell metacharacters in a row value. Verify exact quoted output, copy/close behavior, and stage without Enter. Repeat with SSH, a different cwd, a changed terminal, a busy prompt and an existing draft; staging must fail closed.
- Check Docker hidden-window polling, failed refresh/retry, and Stage logs/inspect/shell. Confirm there is no accidental execution on opening a custom tool or inspecting a row.
- Run long/noisy command fixtures and confirm native timeout cleanup and bounded output. Automated tests cover these paths, but live Tauri, terminal integration, accessibility, Windows, and service-specific smoke tests remain release requirements.
