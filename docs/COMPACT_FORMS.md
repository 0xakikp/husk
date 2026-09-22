# Compact sidebar forms

Workflows (editor, import, run review and capture), SSH connection forms, and the Bookmarks form use the opt-in controls in `src/components/compact-form.tsx`. Their theme and density live in one stylesheet, `compact-form.css`; feature styles should contain layout only.

- Controls: 32px high, 12px text, 6px corners, shared theme surfaces and borders.
- Labels: 11px, 6px field gap. Form groups use a 12px gap.
- Actions: 28px high; 24px for small row/icon actions. One understated primary footer action, ghost Cancel/Collapse, destructive actions separate. Group Cancel/Collapse and Save in `compact-actions-main` so they wrap together in a narrow panel, with `compact-action-start` for any leading destructive action.
- Focus, disabled and invalid states use theme tokens. Native radios/checkboxes keep their semantics and compact sizing; native and Radix selects share the closed-control dimensions.
- Panel shell: `compact-panel` uses the app background/foreground and shared border, not the grey popover surface. Use it for docks and dialogs; `compact-dialog` only adds floating elevation. Sidebar sheets remove their extra border, corners and shadow because the rail already frames them.
- All forms use the shared PanelHeader and `compact-body` (12px padding). `Modal compact` opts in without changing unrelated dialog layouts or keyboard behavior. Legacy sidebar density rules explicitly exclude compact panels: moving a form into the rail must not turn 32px controls into 26px controls.
- Sections are flat, with muted labels. Only repeated groups such as workflow steps get a card border; do not nest a second bordered section around them. Workflow discard/collapse/save share one action row, followed by the draft-persistence hint.

Use CompactInput/CompactTextarea/CompactSelect or the CompactSelectTrigger/Content/Item wrappers for existing Radix selectors. These forward refs, event handlers and accessibility attributes. Use associated labels, descriptive icon-button names and error associations. Do not add feature-specific blue/white/black input skins or override the shared control sizes.

The workflow draft reminder is a normal layout row above the workspace, not a floating notification. Collapsing/resuming changes available space but preserves the source terminal/chat element and draft. Check narrow panels, both themes, focus rings, menus and long labels in the live desktop app before release; DOM tests cannot confirm pixel-level rendering.
