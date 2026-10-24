# Settings

Open Settings in the workspace or in a separate window. Both use the same
theme, font, accent, and live preferences.

- Search by the actual control name (for example `scrollback`, `terminal font
  size`, or `minimap`). A result opens its area, expands an Advanced section if
  needed, and focuses/highlights the control.
- Ordinary preferences save automatically. The header distinguishes pending,
  saving, saved, and failed changes. On failure, keep Settings open and use
  **Retry**; Husk does not replace a malformed configuration file.
- Agent and prompt editors use explicit Save. Changed drafts require discard
  confirmation before leaving; failed saves keep the draft available. Closing
  Settings waits for pending preference writes.
- Open windows synchronize preferences. Native saves merge changed fields into
  the latest document, including nested wallpaper fields. Concurrent edits to
  the same field or list still use the last successful write.

## Backup & transfer

Generate an encrypted backup locally using a passphrase of at least eight
characters, then copy the encrypted text yourself. There is no automatic cloud
upload, and Husk cannot recover a forgotten passphrase.

Backups include preferences, provider/model selection, agent and prompt
definitions, appearance presets, and file/folder bookmarks. They exclude API
keys and keychain references, MCP configurations, custom endpoints, SSH
connections, command bookmarks, custom CSS, plugin folders, chat, notes, and
terminal history. Instructions and paths can still contain private text.

Import first decrypts and validates a read-only preview. Inspect the definitions
and exclusions before confirming. Confirmation merges matching fields and IDs;
it does not delete unrelated items. Paths may need updating on another machine.
Configuration, agent files, and bookmarks are separate resources: an interrupted
import can be partially applied, reports that possibility, and can be retried.
Legacy backups support only validated file/folder bookmark recovery.

## Integrations and privacy

MCP arguments are a JSON string array, such as
`["--directory", "/path with spaces/project", ""]`. Each element is one argument;
spaces, quotes, empty arguments, and newlines are preserved without shell splitting.

The crash-reporting switch takes effect in open windows immediately. Opting out
blocks new events and pending SDK startup, but cannot recall already-sent
requests. Reports can include error messages and stack traces, so diagnostic
text may contain private information. Automatic request/user context and
breadcrumbs are disabled.
