# Bottom Bar Designs — "Alive" Terminal Strip

## Option A: Process Pulse (matches your screenshot)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [██████░░░░] Building… 67%  [██░░░░░░░░] Deploying…  [●] Test server running │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Pure jobs dashboard** — shows only running background tasks
- Progress bars use Unicode block chars (`█`, `░`) for terminal-native feel
- Each job is a pill with: progress bar → label → status
- Jobs auto-detected from PTY child processes (via `ps` polling)
- Click a job → expand log tail + cancel button
- Completed jobs flash green and slide out
- Empty state shows subtle pulsing dot: `● Waiting for tasks…`

## Option B: Context + Jobs Hybrid

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [Git] Commit  Diff  Stash │ [████░░░░] Build 67% │ [●] Server │ [>_]       │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Left**: Context-aware quick actions (changes based on terminal state)
  - Git dirty → `[Commit] [Diff] [Stash]`
  - Docker running → `[Stop] [Logs] [Prune]`
  - Last command failed → `[Retry] [Explain] [Fix]`
  - No context → hidden (more space for jobs)
- **Center**: Running job pills with progress
- **Right**: Collapsed `[>_]` icon → click expands to mini input
- Everything is a pill/badge — uniform look

## Option C: AI-Driven Action Bar

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚠ Build failed at src/index.ts:42  [Fix with AI] [Clean rebuild] [Tsc check] │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Single message strip** — like a notification but alive
- AI reads terminal output every 2s and suggests the top 3 actions
- Shows warnings, errors, completions with relevant buttons
- Running jobs shown as compact badges: `[Build 67%]` `[Server ●]`
- Dismissible per-message (swipe or ×)
- Messages auto-expire after 30s unless pinned

## Option D: Full Command Center

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [Git:3] [C] [D] [S] │ [████░░] Build │ [●] Server │ npm run dev      [→] │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Left**: Context shortcuts (icons + tooltips, ultra-compact)
- **Center**: Jobs ticker (scrolls if too many)
- **Right**: Inline command input (always visible, type and hit Enter)
- Input has prefix modes (`#` snippets, `@` files) like before
- Jobs + context + input all in one strip
- Most information-dense option

## Recommendation

**Option B (Context + Jobs Hybrid)** gives you the best of both worlds:
- Feels alive because context buttons constantly change
- Jobs dashboard gives you the progress bars you want
- Still has quick input when you need it
- Matches the "alive" feel without being overwhelming

Which one should I build?
