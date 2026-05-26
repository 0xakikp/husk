# Bottom Bar Environment Badges — Design Document

## Overview
Replace the Quick Cmd button on the bottom bar with a compact strip of **Environment Badges** that show the active dev context for the current terminal's working directory. Click any badge to switch context.

## Detected Environments

| Badge | What It Shows | How It's Detected | Click Action |
|-------|--------------|-------------------|--------------|
| **Node** | `node v20.11.0` or `node (pnpm)` | `node --version` + presence of `package.json`, `pnpm-lock.yaml`, etc. | Dropdown to switch Node version (if nvm/fnm installed) |
| **Python** | `py 3.11` or `venv: myenv` | `python --version` + `VIRTUAL_ENV` env var, or `poetry`/`pipenv` detection | Dropdown to activate/deactivate venvs found in `~/.virtualenvs` or project |
| **Docker** | `docker desktop` or context name | `docker context ls` current context | Dropdown to switch Docker context |
| **AWS** | `aws: prod` | `AWS_PROFILE` env var or `~/.aws/config` default | Dropdown to pick AWS profile |
| **K8s** | `k8s: minikube` or namespace | `kubectl config current-context` + current namespace | Dropdown to switch context/namespace |
| **Git** | `main ↑2 ↓1` | Already implemented — group it here visually | Click opens git panel or branch switcher |
| **Terraform** | `tf: dev` | `.terraform/environment` or `terraform workspace show` | Dropdown to switch workspace |
| **Ruby** | `ruby 3.2` or `rbenv: 3.2` | `ruby --version` + `.ruby-version` | Dropdown if rbenv/rvm |
| **Go** | `go 1.22` | `go version` + `go.mod` | — |
| **Rust** | `rust 1.78` | `rustc --version` + `Cargo.toml` | — |

## Visual Design

```
[typing pulse] [exit code] [context pills] [jobs] [spacer]

  [Node v20] [py3.11 · venv] [aws:prod] [k8s:minikube] [git:main ↑2]    [clock] [online]
  ─────┬────  ───────┬──────  ────┬────  ──────┬───────  ─────┬────
       │             │            │            │              │
    click →      click →      click →      click →        click →
   node menu    venv menu    aws menu     k8s menu       git panel
```

### Badge styling
```
inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]
```

**Color scheme per environment:**
- **Node** — `bg-emerald-500/10 text-emerald-500` (green, JS ecosystem)
- **Python** — `bg-amber-500/10 text-amber-500` (yellow, Python logo)
- **Docker** — `bg-sky-500/10 text-sky-500` (blue, Docker whale)
- **AWS** — `bg-orange-500/10 text-orange-500` (orange, AWS brand)
- **K8s** — `bg-blue-500/10 text-blue-500` (blue, Kubernetes)
- **Git** — `bg-violet-500/10 text-violet-500` (purple)
- **Terraform** — `bg-indigo-500/10 text-indigo-500` (purple-blue)
- **Go** — `bg-cyan-500/10 text-cyan-500` (cyan)
- **Rust** — `bg-red-500/10 text-red-500` (rust orange-red)

### Active vs inactive
- **Active** (relevant to current cwd): full opacity, visible
- **Inactive** (not relevant): hidden entirely (no wasted space)
- **Hover**: slightly brighter background (`hover:bg-X/20`)

## Architecture

### New module: `src/env-badges/`

```
src/env-badges/
├── types.ts          # EnvBadge type, detection result
├── detect.ts         # Async detection functions per env
├── useEnvBadges.ts   # Hook that polls detectors
├── EnvBadgeStrip.tsx # React component for the strip
└── menus/            # Dropdown menus for each badge
    ├── NodeMenu.tsx
    ├── PythonMenu.tsx
    ├── AwsMenu.tsx
    ├── K8sMenu.tsx
    └── DockerMenu.tsx
```

### Detection strategy
All detection is **async** and **non-blocking**:
1. Fire all detectors in parallel via `Promise.allSettled`
2. Cache results per cwd (invalidate on cwd change)
3. Poll every 3 seconds (same interval as git detection)
4. Each detector returns `null` if not applicable

### Example detector
```ts
// detect.ts
export async function detectPython(cwd: string): Promise<EnvBadge | null> {
  const [version, venv] = await Promise.all([
    exec("python --version").catch(() => null),
    readEnvVar("VIRTUAL_ENV"),
  ]);
  if (!version) return null;
  return {
    id: "python",
    label: venv ? basename(venv) : version,
    detail: version,
    icon: PythonIcon,
    color: "amber",
  };
}
```

### Integration into bottom bar
Replace the Quick Cmd button area in `TerminalBottomBar.tsx`:

```tsx
{/* Environment badges */}
<EnvBadgeStrip cwd={activeCwd} />

{/* Keep: clock, online dot */}
<div className="...">{timeStr}</div>
```

The `EnvBadgeStrip` renders badges left-to-right, each badge is clickable.

### Click interaction
Each badge has a small dropdown menu:
- **Node**: List of installed versions (nvm ls), "Use default"
- **Python**: List of venvs, "Deactivate", "Create new venv"
- **AWS**: List of profiles from `~/.aws/config`
- **K8s**: List of contexts, list of namespaces
- **Docker**: List of contexts

Menus are small (max 200px height), scrollable, same style as the model dropdown.

## Fallback when no environments detected
If the cwd has no recognizable environments, the badge strip is simply empty and the bottom bar stays minimal. No placeholder needed.

## Files to modify
1. `src/terminal/TerminalBottomBar.tsx` — replace Quick Cmd with `<EnvBadgeStrip />`
2. `src/ai/terminalContext.ts` — ensure `getActiveTerminalCwd()` is exported
3. Create `src/env-badges/` module

## Implementation phases
1. Create `src/env-badges/types.ts` and `detect.ts` with 3 core detectors (Node, Python, Git)
2. Create `EnvBadgeStrip.tsx` with basic rendering
3. Wire into `TerminalBottomBar.tsx`
4. Add dropdown menus for switching
5. Add remaining detectors (AWS, K8s, Docker, etc.)
