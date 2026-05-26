# Testing Guide — Terminal AI + Bottom Bar

## 1. `/ai` Terminal Interceptor

Type these directly in the terminal prompt:

```bash
npm run build
# If build fails:
/ai what does this error mean?

ls -la
/ai explain what I see

cat package.json
/ai what are the main dependencies?

git log --oneline -5
/ai summarize recent changes
```

**What should happen**: The `/ai ...` line disappears from the terminal after you hit Enter. The AI window auto-expands and streams a response using the terminal output as context.

---

## 2. AI Floating Bubble

- **Click the green bubble** (bottom-right corner) → window expands
- **Drag the header** → moves the window
- **Drag any edge/corner** → resizes freely
- **Click minimize** → collapses back to bubble
- **Click close** → collapses and clears chat history

---

## 3. Terminal Bottom Bar — Context Pills

The bar auto-detects context every 3 seconds. Try these:

### Git dirty state
```bash
# Modify any tracked file
echo "test" >> README.md
```
**Bar shows**: `[Commit] [Diff] [Stash]` — click any to run the command.

### Git clean state
```bash
git add . && git commit -m "wip"
```
**Bar shows**: `[Pull] [Status]`

### Error state
```bash
false          # exits with code 1
# or
exit 1
```
**Bar shows**: `[Retry] [Explain]` — Retry runs `!!`, Explain sends `/ai explain this error`

### Docker state
```bash
# Ensure docker daemon is running
docker ps
```
**Bar shows**: `[PS] [Prune]`

---

## 4. Terminal Bottom Bar — Job Pills

Start background tasks and watch the bar:

```bash
# Long-running background job
sleep 60 &

# Or use the Jobs panel (from sidebar) to start a background command
# Jobs → New → `npm run dev` → Start
```

**Bar shows**: `[████░░░░] sleep 5s` with a live timer updating every second.

Multiple jobs:
```bash
sleep 30 &
sleep 45 &
```
**Bar shows**: Multiple pills side by side, scrollable.

---

## 5. Terminal Bottom Bar — Quick Command

1. Click **Cmd** button (far right of bar)
2. Type `git status` → press **Enter**
3. Command runs in terminal, bar auto-collapses

Or:
1. Click **Cmd**
2. Type `clear` → **Enter**
3. Terminal clears

Press **Escape** to cancel without running.

---

## 6. Drag & Drop Files

1. Drag any file from your desktop/file manager
2. Drop it onto the bottom bar
3. The file path appears in the terminal as if you typed it

---

## 7. SSH Environment Test

```bash
ssh user@your-server
/ai what OS is this?
```

**Should work**: The `/ai` command is intercepted at the frontend (xterm.js) before it ever reaches the SSH connection. The AI sees your SSH session output and responds.

---

## Quick Reference Table

| Feature | How to Trigger | Expected Result |
|---------|---------------|-----------------|
| `/ai` intercept | Type `/ai <question>` + Enter | Line vanishes, AI window opens with answer |
| AI bubble move | Drag header | Window moves |
| AI bubble resize | Drag corner/edge | Window resizes |
| Context pills | Modify git file / run `false` | Green action buttons appear |
| Job pills | `sleep 30 &` | Progress pill with timer appears |
| Quick command | Click `Cmd` → type → Enter | Command runs in terminal |
| File drop | Drag file onto bar | Path inserted in terminal |
