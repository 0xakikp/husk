# Bottom Bar — Smart Context Pills (Final Design)

## Core Insight

The bottom bar's **most valuable feature** is already the context pills (Commit, Diff, Pull, Retry, Explain). The Quick Cmd adds almost nothing. Instead of inventing a new feature category, we **expand and deepen** what already works.

## Problem with Current Context Pills

They're too limited — only 4 hardcoded contexts:
- Git dirty → Commit, Diff, Stash
- Git clean → Pull, Status  
- Docker running → PS, Prune
- Error → Retry, Explain

## New Design: Project-Aware Smart Pills

The bottom bar detects the **project type** from the current directory and surfaces the most common commands as one-click pills.

### Detection Matrix

| Detected | Trigger Files | Smart Pills Shown |
|----------|--------------|-------------------|
| **Node.js** | `package.json` | `npm install` `npm run dev` `npm test` `npm run build` |
| **Python** | `requirements.txt` / `pyproject.toml` / `Pipfile` | `pip install` `pytest` `python -m` `black .` |
| **Rust** | `Cargo.toml` | `cargo build` `cargo test` `cargo run` `cargo check` |
| **Go** | `go.mod` | `go test` `go run .` `go build` `go mod tidy` |
| **Docker** | `Dockerfile` / `docker-compose.yml` | `docker build` `docker compose up` `docker ps` |
| **Terraform** | `*.tf` | `terraform plan` `terraform apply` `terraform fmt` |
| **Django** | `manage.py` | `runserver` `migrate` `makemigrations` `shell` |
| **Rails** | `Gemfile` + `config/routes.rb` | `rails server` `rails console` `rspec` `rake db:migrate` |

### Dynamic State-Aware Pills

Beyond project type, pills adapt to the **current state**:

```
if package.json modified since last npm install:
  → show [npm install] with amber warning color

if .env is missing but .env.example exists:
  → show [cp .env.example .env]

if untracked migrations exist:
  → show [python manage.py migrate]

if go.mod has unused imports:
  → show [go mod tidy]

if Cargo.toml has new deps:
  → show [cargo build]
```

### Visual Design

```
[typing pulse] [exit code] [git branch ↑2↓1] [smart pills] [jobs] [spacer] [clock] [online]

                         ┌─ smart pills area ─┐
  [npm install ⚠] [npm run dev] [npm test] [git diff] [docker ps]
   ──────┬───────  ───────┬──────  ────┬────  ───┬────  ────┬───
         │                 │            │         │          │
      amber if            click      click     click      click
      out of date         → runs   → runs    → runs     → runs
```

**Pill styling:**
```
inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium
```

- **Normal**: `bg-primary/8 text-primary hover:bg-primary/15`
- **Warning** (out of date, missing): `bg-amber-500/10 text-amber-500 hover:bg-amber-500/20`
- **Danger** (tests failing, build broken): `bg-red-500/10 text-red-500 hover:bg-red-500/20`

### Priority Rules

When space is limited (small window), pills are prioritized:
1. **State warnings** (out of date, missing files) — always shown
2. **Most-used** commands (learned from user's own history)
3. **Project defaults** (dev, test, build)
4. **Git actions** (if git dirty)

Max 5-6 pills visible. Overflow becomes a "+3" dropdown.

### How "Most-Used" is Learned

Track which smart pills the user clicks most often per project type:
```ts
type PillUsage = {
  projectType: string;
  command: string;
  clicks: number;
  lastUsed: number;
};
```

Sort pills by `(clicks * recencyWeight)` so frequently-used commands bubble to the front.

### Architecture

**New module: `src/smart-pills/`**

```
src/smart-pills/
├── types.ts           # SmartPill, ProjectType, PillUsage
├── detectProject.ts   # Detect project type from cwd
├── suggestPills.ts    # Generate pill list from project + state
├── usageStore.ts      # Persist click counts
├── useSmartPills.ts   # Hook: polls detectors + returns pills
└── SmartPillStrip.tsx # React component
```

**Pill strip component:**
```tsx
function SmartPillStrip({ cwd }: { cwd: string }) {
  const pills = useSmartPills(cwd);
  return (
    <div className="flex items-center gap-1">
      {pills.map((p) => (
        <button
          key={p.command}
          onClick={() => {
            recordPillClick(p);
            onSendToTerminal(p.command);
          }}
          className={cn("...", p.priority === "warn" && "bg-amber-500/10")}
          title={p.command}
        >
          {p.icon && <HugeiconsIcon icon={p.icon} size={11} />}
          {p.label}
          {p.priority === "warn" && <span className="text-amber-500">!</span>}
        </button>
      ))}
    </div>
  );
}
```

**Integration into `TerminalBottomBar.tsx`:**
Replace the Quick Cmd button area with `<SmartPillStrip cwd={activeCwd} />`.

### Why This Adds Value

1. **Reduces typing** — the 5 commands you run 80% of the time are one click away
2. **Context-aware** — pills change based on project type, not static
3. **State-aware** — warns when dependencies are out of date
4. **Learns from you** — most-used commands bubble to the front
5. **Zero sidebar overlap** — sidebar manages tools, bottom bar suggests commands
6. **Builds on existing strength** — expands the already-useful context pills concept

### Files to Create/Modify

1. Create `src/smart-pills/` module (types, detect, suggest, usage store, hook, component)
2. Modify `src/terminal/TerminalBottomBar.tsx` — replace Quick Cmd with SmartPillStrip
3. Modify `src/settings/preferences.ts` — add `smartPillUsage` persisted state
4. Modify `src/ai/terminalContext.ts` — expose `getActiveTerminalCwd()` if not already
