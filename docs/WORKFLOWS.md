# Workflows: edit, share, and review

## Editor

Choose **New workflow** or **Edit** in the Workflows sidebar. The editor replaces the list inside that existing rail; it never adds another column beside the terminal or AI conversation. The sidebar keeps its current width. Drag its divider, or focus it and use arrow keys, if you want more editing space. AI chat keeps its existing size, spacing and resize behavior.

The initial form shows **Name + Steps**. Optional fields are tucked away:

- **Description (optional)** expands when needed. Existing descriptions are visible when editing.
- **Steps** — one command line per numbered card, **Add title**, Add / Duplicate / Delete / Move up / Move down. Blank cards are validation errors, not silently discarded commands.
- **Inputs** — expand for name, display label, text/number/path/secret type, optional default, and Required. Secret inputs cannot have saved defaults. **Insert input…** inserts a placeholder at the command cursor. Renaming an input does not silently rewrite existing commands; update their placeholders too.
- **Execution options** — shell behavior and **Stop when a step fails** (on by default).

**Collapse** (or Escape inside the editor) keeps all draft fields and returns to the workflow list. **Resume** in the slim draft row above the workspace, or **Resume draft** in the Workflows sidebar, restores it. The draft row appears when the editor is collapsed or its sidebar is hidden/on another view; it never floats over terminal/chat content or the status bar. Explicitly opening, resuming or collecting into a draft reveals the Workflows rail; ordinary updates never pull you away from another sidebar view. Switching tabs, chat/terminal views, or hiding the sidebar does not discard the draft. There is one current draft per window; creating another asks before replacing it. **Discard draft** also requires confirmation. Drafts are only in window memory, not saved to disk or sent to AI automatically; save before closing/restarting Husk. Failed saves retain the draft, and a saved workflow changed elsewhere cannot be silently overwritten. Reopening during a pending save keeps the editor locked, and a failed save is reported even if you closed the sidebar.

## Collect commands from the screen

- Select terminal text and choose **Add to workflow…** from its selection toolbar or right-click menu. This works with AI disabled.
- Use **Add to workflow…** beside Copy on an AI code block explicitly labelled `sh`, `bash`, `zsh`, or `shell`. Non-shell source code does not get this action.
- Review the exact captured text, choose **New workflow** or **Current draft**, then **Add to draft**. Adding never executes commands, contacts AI, or changes saved workflows. Choosing New while a draft exists requires explicit replacement confirmation. Capture is disabled while saving and rechecks the chosen draft identity.
- Prompts/output and whitespace are not guessed or stripped. Review the selection carefully. Multiple lines stay together in one editable card; manually split/rewrite them into standalone one-line steps before running. Scripts, heredocs and continuations are not automatically converted. Oversized/control-bearing text is rejected without truncating or sanitizing it.

Example: collect `git status` from the terminal into a new draft; name it; collapse; collect `git diff --stat` from an AI shell block into **Current draft**; review both steps and save.

Existing `{{name}}` and `{{name=default}}` placeholders still work. Detected inputs can be configured in the editor. Number inputs accept finite signed decimal/exponent values, not expressions. Paths are literal strings, not automatically expanded user-input shell syntax. Choose an actual path rather than entering `$HOME` or `~` as the runtime value. An authored `~/{{folder}}` prefix remains supported.

Example: command `git log -n {{count}} --oneline`; add a number input named `count`, label **Number of commits**, default `5`, Required enabled. At run time Husk shows that labelled field and the expanded command.

Saving is local, never executes commands, and only reports success after SQLite accepts the change. Definitions are stored in `~/.husk/state.sqlite` with a browser-storage compatibility copy under `huskv2.runbooks`. Failed saves leave the editor open. Unreadable durable data is not overwritten by an empty fallback. Runtime input values and terminal approvals are not saved as part of the workflow.

## Library: search, pins and linked scripts

Use the header **Search** icon to filter names, descriptions, commands and linked paths locally. Escape clears the search and restores the list. Pin a workflow or script to place it in **Pinned**; unpinning keeps the item.

**Link script…** selects an existing local file. Husk saves its path, not a copy of its contents. Linking, searching, pinning and opening a file never execute it. **Open original file** opens the actual local file in Husk, even when another sidebar is browsing SSH files. Removing a link does not delete that file.

**Review & run** shows the target terminal, working directory and quoted script path. Linked scripts run only on a verified local terminal, using the current file on disk. The script must be executable with a valid shebang. Husk does not infer an interpreter, change permissions, transfer the file to a remote host, or change the terminal directory. Review the file before running it; edits made after linking apply to subsequent runs.

Pins and script paths are saved in device-local WebView storage (`huskv2.workflow-library.v1`) until removed or app browsing data is cleared. They survive ordinary restarts but are not included in workflow JSON exports or cloud sync. Workflow definitions continue to use SQLite as described above.

After submission, a row shows **Awaiting result** until shell integration reports a matching completion. Only observed exit codes produce **Last run succeeded/failed**. If completion cannot be verified within two minutes, it shows **Result unavailable**; this does not stop the command, which may still be running. A later verified completion can update that result.

**View output** shows the original target and a bounded terminal capture without rerunning anything. The most recent run per item is kept in window memory only (up to 100 items, 8 KiB output each), cleared on window close/reload or removal. These are not durable logs or a check of the current definition/file. Secret-input runs and captures flagged as credential-bearing omit output; detection is heuristic, so do not assume arbitrary logs are free of secrets. Nothing in this result viewer is automatically sent to AI.

## Import and export

- **Workflows → … → Import JSON…**: choose a file or paste JSON, then **Preview import**.
- Inspect incoming commands, titles, inputs, and any matching existing workflows. Conflicts are matched by ID or case-insensitive name.
- Choose **Keep both** (new ID/name as needed), **Replace** a specific reviewed saved workflow, or **Skip**. Conflicts require a choice; changed saved data invalidates the preview. Two imports cannot replace the same record.
- **Import reviewed workflows** saves definitions only. It never executes them or contacts AI.
- Right-click a workflow → **Export JSON…** exports one; the header menu offers **Export all workflows…**. **Copy workflow JSON** uses the same portable format.
- A cancelled file chooser writes nothing. Replacing an export file uses the native save dialog's overwrite flow.

Version 1 example:

```json
{
  "format": "husk-workflows",
  "version": 1,
  "workflows": [
    {
      "id": "wf_recent_commits",
      "name": "Recent commits",
      "description": "Review recent Git history",
      "steps": ["git log -n {{count}} --oneline"],
      "stepTitles": ["Show commits"],
      "stopOnError": true,
      "inputs": [
        { "name": "count", "label": "Number of commits", "type": "number", "defaultValue": "5", "required": true }
      ]
    }
  ]
}
```

Legacy single workflow objects and arrays from the previous **Copy workflow JSON** action are accepted. IDs and names are required. Unsupported format versions, malformed definitions, duplicate IDs, invalid input metadata, and oversized data are rejected rather than truncated. Unknown runtime/UI fields are excluded from the canonical definition.

Limits: 500 workflows; 100 steps per workflow; 8,000 UTF-8 bytes per step; 32 inputs; 64-byte input identifiers; 160-byte names, labels and step titles; 2,000-byte descriptions/defaults/runtime values; 1 MiB stored/imported/exported collection. Pretty-printed exports near the size limit may require exporting fewer workflows.

Exports contain definitions, never the runner's entered values or captured target. Secret defaults are forbidden. A heuristic also blocks likely hard-coded credentials and credential-like defaults. This is not a guarantee that every sensitive string can be detected: review definitions before sharing, and replace credentials with secret runtime inputs.

## Run review and safety

Every run opens a preview, including parameterless workflows and command-palette launches. It shows Local/SSH host, terminal identity, directory, expanded steps, and the exact submitted command. Required inputs and number types are validated. **Run workflow** is the single execution confirmation: there is no separate “I reviewed” checkbox or second confirmation dialog. Opening the preview, filling inputs, or refreshing the target never executes anything. Approval is not saved for future runs.

The run preview is a compact, content-sized panel centred in the main workspace, excluding the sidebar, title bar and status bar. It stays centred as the sidebar or window is resized; standalone previews fall back to the window centre. Width is capped at 520px, height at 640px or the available workspace height, with 16px edge clearance. Target and directory appear above a numbered command list; optional step titles appear only when supplied. **Execution details** expands shell behavior and the exact submitted command. Stop/continue-on-error behavior and secret warnings remain visible without expanding details. Long previews scroll inside the keyboard-focusable body while the header and Cancel/Run footer stay visible. Import and capture layouts are unchanged.

Running requires an empty, idle prompt with verified shell integration. Switching directory, terminal, or SSH connection invalidates the captured target; **Refresh target** explicitly captures and displays the new target before Run becomes available. Unknown/busy prompts and existing drafts fail closed. The preview observes readiness locally while open, and execution rechecks it at click time. Unrelated exit-status updates do not clear submission errors or require another acknowledgement. Repeated clicks while submitting cannot send duplicate submissions.

Runtime inputs are literal shell arguments, including within simple quoted placeholders or prefixes/suffixes. They are not shell snippets and do not split into multiple arguments. Dynamic executable names, shell assignments/dispatchers/interpreters with inputs, and ambiguous parameterized shell grammar (substitutions, redirections, heredocs, functions) are rejected. For complex logic, put it in a reviewed executable script and pass literal arguments to that script. Programs can interpret arguments as flags or code; quoting does not make an arbitrary workflow harmless. Use tools' `--` argument delimiters when appropriate and only run workflows you trust.

Steps run sequentially in one **POSIX `sh` child process**. Directory/environment changes carry between steps but do not change the interactive terminal's directory after completion. Interactive aliases/functions and shell-specific syntax are not inherited; Windows shells need a POSIX environment. Each card's final exit status determines failure. **Stop when a step fails** prevents later cards from running; it cannot detect a failure that an authored expression intentionally masks. The runner sends exactly one reviewed command and a final Enter to the captured PTY. A successful submission is not a claim that the workflow succeeded—read the terminal output/exit status.

Secret values are hidden in the preview unless explicitly revealed. They are not persisted in workflow definitions, but executing a CLI command can expose them in shell history, process arguments, terminal logs, or output. Prefer credentials already supplied through a trusted environment/keychain when the tool supports that. Husk does not promise secure secret injection into arbitrary shell commands.

## Release smoke checks

1. Create the Git example above; duplicate/reorder/delete a step and verify titles move with commands. Insert an input at the cursor, change its type, and test required/invalid values. Save, restart, and verify metadata persists.
2. Export one/all workflows, import the exported file and paste it. Exercise all conflict choices, duplicate IDs, invalid JSON, missing folders, too-large files and cancellation. Inspect existing commands before Replace. No import/save should run a command.
3. Launch a parameterless workflow from both sidebar and command palette. Both must require preview/confirmation. Change the terminal/cwd/SSH connection or type a draft after opening review; Run must refuse until a verified target is reviewed again.
4. In a disposable shell, review steps `false` and `printf first; printf second`. Stop-on-error must print neither string; Continue must run the second card. Check a `cd` followed by `pwd`, noting that the terminal's cwd is unchanged after the child exits.
5. Test literal input containing spaces, single/double quotes, semicolons and dollar-sign expressions. They must arrive as one argument, not execute as shell code. Multiline/control-bearing runtime values must be rejected.
6. Test native save failure, reopen/cancel behavior, narrow windows, keyboard focus and both themes in the desktop app. Automated DOM/native tests do not replace live terminal integration, OS file-dialog and visual checks.
7. Collect a terminal selection into a new draft, edit its name/metadata, resize and collapse, then collect an AI shell block into Current draft. Verify all edits survive, the terminal/chat stays usable, and no PTY write or save occurs until explicitly requested. Repeat with a narrow window, sidebar hidden, a cancelled replacement, and a pending/failed save.
8. Search by name, command and linked path; press Escape and verify the full list returns. Pin both kinds of item, restart Husk, and confirm the pins and file links remain. Cancel the script chooser and remove a link: neither action should modify or execute a file.
9. Link a disposable executable script with a shebang; open and edit the original file, then review/run it in a local test terminal. Verify an SSH target is refused. Exercise success, nonzero exit, missing/deleted file, and unknown completion. View output without rerunning; reload the window and confirm run results (not pins/links) are cleared.
