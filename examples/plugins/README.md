# Husk plugins

A plugin is one JSON file. Husk runs the command, parses the output, and renders
it with its own components — so plugins look like the rest of the app and keep
looking like it when the app is restyled.

Point Husk at a folder of these files: **sidebar → Plugins → +**.

## Format

```json
{
  "name": "Nomad",
  "description": "Jobs and allocations",
  "brand": "#00CA8E",
  "views": [
    {
      "title": "Jobs",
      "command": "nomad job status",
      "format": "table",
      "columns": ["ID", "Type", "Status"],
      "refresh": 10,
      "empty": "No jobs running.",
      "actions": [
        { "label": "Status", "command": "nomad job status {ID}" },
        { "label": "Stop", "command": "nomad job stop {ID}", "run": false }
      ]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `name` | Shown in the list. Defaults to the filename. |
| `brand` | Hex colour for the icon tile. |
| `views[].command` | Whole command line. Split into program + arguments — **never run through a shell**, so `;` and `$(…)` are not interpreted. |
| `views[].format` | `table` (default, whitespace columns with a header), `lines` (one row per line), `json` (array of objects). |
| `views[].columns` | Which columns to show, in order. Omit for all. Unknown names are ignored. |
| `views[].refresh` | Seconds between automatic refreshes. Minimum 2. Omit for manual only. |
| `views[].actions` | Per-row commands. `{Column}` is replaced with that row's value. |

## Actions type by default

An action **types** its command into the terminal rather than running it, so you
can add arguments first and a mis-click cannot execute anything. Set
`"run": true` when a command is safe to fire immediately.

## Errors are visible

A file that fails to parse is listed with the reason, and a command that exits
non-zero shows its own stderr. Nothing fails silently — you should never have to
guess whether a plugin loaded.

## What plugins cannot do

No custom drawing, and no JavaScript. A plugin can only run commands you could
have typed yourself, which is what makes a folder of them safe to try.
