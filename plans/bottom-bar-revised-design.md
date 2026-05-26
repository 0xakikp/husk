# Bottom Bar — Revised Design (Avoiding Sidebar Duplication)

## Problem Analysis

The original Environment Badges design duplicates functionality already present in sidebar views:

| Proposed Badge | Sidebar Equivalent | Overlap? |
|---------------|-------------------|----------|
| K8s context switcher | KubernetesView (lists contexts, switches, shows pods) | **High** |
| Docker context | DockerView (lists containers, images, contexts) | **High** |
| Terraform workspace | TerraformView (shows workspaces, state, resources) | **High** |
| Git branch | SourceControlPanel + GitGraphPanel | **Medium** |
| AWS profile | AwsProfilesDialog (already exists) | **Medium** |
| Node/Python version | **Not in sidebar** | None |

The sidebar's purpose is **tool management** (browse all containers, all contexts, all workspaces). The bottom bar's purpose is **terminal session awareness** (what's happening RIGHT NOW in the active terminal).

## Revised Direction: Terminal Session Breadcrumb

Instead of env badges, the bottom bar shows the **current working session trail** — a breadcrumb of where you are and what you just did.

```
[typing pulse] [exit code] [context pills] [jobs]

  ~/projects/husk  →  npm test  →  ✗ 3 failures
  ──────┬────────      ───┬───      ─┬─
        │                 │          │
    click → open dir   click →    click →
    in finder         re-run      scroll to
                        cmd       error in
                                    terminal
```

### Components

**1. Working Directory Chip**
```
[📁 ~/projects/husk]
```
- Shows current terminal CWD, truncated with `~` shorthand
- Click → opens folder in system file manager
- Updates when terminal changes directory

**2. Last Command + Exit Code**
```
[npm test] → [✓]     or     [npm test] → [✗ 3]
```
- Shows the most recently executed command
- Green checkmark = success, red X = failure (with exit code)
- Click success → re-run the command
- Click failure → scroll terminal to the error output

**3. Command History Chips (recent, unique)**
```
[ls] [git status] [npm run build] [docker ps]
```
- Last 3-4 unique commands (deduplicated, most recent first)
- One click re-runs
- Right-click to pin a command permanently (persists across sessions)

### Why this doesn't duplicate the sidebar

| Feature | Sidebar | Bottom Bar |
|---------|---------|-----------|
| Browse all Docker containers | ✅ DockerView | ❌ |
| Switch K8s contexts | ✅ KubernetesView | ❌ |
| View git diff/stage/commit | ✅ SourceControlPanel | ❌ |
| Re-run last command | ❌ | ✅ Bottom bar |
| See command history | ❌ | ✅ Bottom bar |
| Quick directory access | ❌ (Explorer shows files, not CWD) | ✅ Bottom bar |
| Error-aware navigation | ❌ | ✅ Bottom bar |

### Visual Design

```
┌─ Terminal Bottom Bar ──────────────────────────────────────────────────────┐
│  ●  [✓]  [📁 ~/p/husk]  [npm test]→  [ls] [git status] [docker ps]  │...│ [12:34:56]  🟢 │
│  │   │       │              │           ───── recent cmds ─────            │   │     │    │
│  │   │       │              │                                              │   │     │    │
│  │   │       │           last cmd                                          │   │   clock online
│  │   │    current dir                                                      │
│  │ exit code                                                               │
│ typing                                                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

**Styling:**
- CWD chip: `bg-muted/20 text-muted-foreground` with folder icon
- Last command: `bg-primary/8 text-primary` (success) or `bg-red-500/10 text-red-500` (failure)
- History chips: `bg-muted/15 text-muted-foreground hover:bg-muted/25`

### Click Actions

| Element | Click | Right-Click |
|---------|-------|-------------|
| CWD chip | Open in system file manager | Copy path to clipboard |
| Last command (success) | Re-run command | — |
| Last command (failure) | Scroll terminal to error | — |
| History chip | Re-run command | Pin/unpin command |

### Data Flow

```
Terminal.tsx ──onData──→ Parse commands (simple regex)
                          └── Store in session history (per terminal tab)
                          └── Update bottom bar via terminalContext

BottomBar.tsx ──poll──→ getActiveTerminalCwd()
                        getActiveTerminalHistory()
                        getActiveTerminalLastExit()
```

### Implementation

**New module: `src/terminal/sessionHistory.ts`**
```ts
export type SessionEntry = {
  command: string;
  timestamp: number;
  exitCode: number | null;
};

export function recordCommand(termId: number, cmd: string): void;
export function recordExit(termId: number, code: number): void;
export function getSessionHistory(termId: number): SessionEntry[];
export function getLastCommand(termId: number): SessionEntry | null;
export function getUniqueRecent(termId: number, n: number): string[];
```

**Modification to `Terminal.tsx`:**
- Parse `\r` or `\n` in terminal data to detect command submission
- Call `recordCommand(termId, cmd)` when user presses Enter
- Call `recordExit(termId, code)` via existing OSC 133 handler

**Modification to `TerminalBottomBar.tsx`:**
- Replace Quick Cmd area with: CWD chip + last command + history chips
- Remove: Quick Cmd button, mini input
- Keep: typing pulse, exit code, context pills, job tracker, clock, online dot

### Why this is better than env badges

1. **Zero sidebar overlap** — no tool management, purely terminal session awareness
2. **Actionable** — every element does something when clicked (re-run, open, navigate)
3. **Temporal** — shows what happened RECENTLY, not static environment state
4. **Muscle memory** — re-running last commands is a very common workflow
5. **Error-aware** — failed commands become clickable navigation to the error

### Files to modify
1. `src/terminal/TerminalBottomBar.tsx` — replace Quick Cmd with session breadcrumb
2. `src/terminal/Terminal.tsx` — hook into data stream to capture commands
3. Create `src/terminal/sessionHistory.ts` — session history store
4. `src/ai/terminalContext.ts` — expose `getActiveTerminalHistory()`
