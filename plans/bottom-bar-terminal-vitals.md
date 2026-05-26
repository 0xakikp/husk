# Bottom Bar — Terminal Vitals (Universal Design)

## Problem with Previous Designs

All previous ideas assume the user is a software developer working in modern frameworks. They're useless for:
- Sysadmins who mainly `ssh`, `scp`, `systemctl`
- Data engineers who run `psql`, `mongo`, `spark-shell`
- Scientists who run `python`, `R`, `julia` scripts
- Anyone who just uses `ls`, `cat`, `grep`, `vim` in random directories

## New Direction: Terminal Vitals

Show information that is **universally relevant to every terminal user**, regardless of what they do. The bottom bar becomes a **health & awareness monitor** for the active terminal session.

### When the Terminal is Idle

```
[typing pulse] [disk free: 45%]  [~/projects]  [clock] [online]
```

### When a Command is Running

```
[typing pulse] [⏱ 2m 34s] [python train.py] [mem: 2.1G] [~/projects] [clock] [online]
```

### When Disk is Low

```
[typing pulse] [⚠ disk 95%] [~/projects] [clock] [online]
```

### When Connected via SSH

```
[typing pulse] [SSH: prod-server-01] [⏱ 45m] [~/projects] [clock] [online]
```

## Detected Vitals (All Universal)

| Vital | Detection | Value For Everyone |
|-------|-----------|-------------------|
| **Foreground Process** | Read PTY foreground PID → resolve command name | See what's actually running RIGHT NOW |
| **Command Duration** | Track time since last Enter (if process still running) | Know how long builds, uploads, queries take |
| **Process Memory** | Read `/proc/{pid}/status` or `ps` RSS | Know if a process is eating RAM |
| **Disk Free** | `df -h .` on current cwd filesystem | Universal — everyone runs out of space |
| **Directory Size** | `du -sh .` (cached, throttled) | Know if current dir is bloated |
| **SSH Host** | `SSH_CONNECTION` env var or `who am i` | Know which remote server you're on |
| **Sudo/Root** | `$EUID` or `whoami` | Warning when running as root |
| **Network RTT** | Ping 1.1.1.1 every 10s | Know if connection is flaky |

## Visual Design

```
┌─ Terminal Bottom Bar ─────────────────────────────────────────────────────────┐
│                                                                               │
│  ●  [⏱ 2m 14s] [python train.py] [mem 2.1G]  [⚠ disk 92%]  [~/projects]  │...│ [12:34]  🟢 │
│  │   ───┬────    ──────┬───────   ────┬────    ────┬───────   ────┬─────      │   │      │    │
│  │       │              │            │            │              │             │   │      │    │
│  │   duration      foreground     memory       disk warning    CWD chip       │   │    clock online
│  │                 process                                                   │
│ typing                                                                        │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Element Details

**1. Foreground Process Chip**
```
[🟢 python train.py]
[🔴 sudo apt upgrade]
[⚪ vim README.md]
[🟡 ssh user@server]
```
- Shows the name of the command currently occupying the terminal
- Color dot: green (normal), red (root/sudo), yellow (network/ssh)
- Click → send SIGTERM (graceful stop) with confirmation
- Right-click → send SIGKILL (force kill)

**2. Duration Timer**
```
[⏱ 2m 14s]
```
- Counts up from when Enter was pressed
- Only appears while a foreground process is running
- Turns amber after 1 minute, red after 5 minutes
- Click → copy duration to clipboard

**3. Memory Badge**
```
[mem 2.1G]
```
- RSS of the foreground process
- Only appears if >100MB (noise filter)
- Turns amber if >1GB, red if >4GB
- Click → run `htop` or `top` focused on this PID

**4. Disk Warning**
```
[⚠ disk 95%]
```
- Only appears when disk usage >85%
- Shows percentage, not absolute (universal)
- Click → run `du -sh * | sort -h` in current dir

**5. Directory Size**
```
[📁 4.2G]
```
- Total size of current working directory
- Only appears if >1GB (noise filter)
- Updated every 30 seconds, cached
- Click → run `ncdu` or `du -sh * | sort -h`

**6. SSH Badge**
```
[SSH: prod-server-01]
```
- Only appears when in an SSH session
- Shows hostname, truncated
- Click → copy SSH command to clipboard
- Hover → show full connection string

**7. Root Warning**
```
[🔴 root]
```
- Always visible when running as root
- Red pulsing dot
- Cannot be dismissed

**8. Network RTT**
```
[● 12ms]
```
- Small green/yellow/red dot + latency
- Green <50ms, Yellow 50-200ms, Red >200ms or offline
- No label, just dot + number (minimal)

## State Machine

The bottom bar has **modes** based on terminal state:

```
MODE: idle
  → show: [CWD] [disk if warning] [network] [clock] [online]
  
MODE: running (process in foreground)
  → show: [duration] [process] [memory if high] [CWD] [network] [clock]
  
MODE: ssh
  → show: [SSH host] [duration if running] [CWD] [network] [clock]
  
MODE: root
  → show: [root warning] + whatever mode is active
```

## Why This is Universally Useful

| User Type | Benefit |
|-----------|---------|
| **Sysadmin** | SSH host visible, disk warnings, process duration |
| **Developer** | Build duration, process memory, disk space |
| **Data Engineer** | Long query duration, memory usage, disk for large datasets |
| **Scientist** | Script runtime, memory for heavy computations |
| **Casual user** | Disk warnings (everyone fills their drive), network status |

## Architecture

**New module: `src/terminal/vitals/`**

```
src/terminal/vitals/
├── types.ts           # Vital, VitalKind, ProcessInfo
├── detectProcess.ts   # Get foreground PID + command name
├── detectDisk.ts      # df -h for cwd filesystem
├── detectDirSize.ts   # du -sh . (throttled)
├── detectMemory.ts    # /proc/{pid}/status or ps
├── detectNetwork.ts   # ping 1.1.1.1
├── detectSsh.ts       # SSH_CONNECTION env var
├── useVitals.ts       # Hook combining all detectors
└── VitalStrip.tsx     # React component
```

**Detectors run on a schedule:**
- Process detection: continuous (via terminal data callbacks)
- Disk: every 10 seconds
- Dir size: every 30 seconds
- Network ping: every 10 seconds
- SSH: every 5 seconds

**All detectors return `null` when not applicable**, so the bar only shows what's relevant.

## Files to Modify

1. `src/terminal/TerminalBottomBar.tsx` — replace Quick Cmd with VitalStrip
2. `src/terminal/Terminal.tsx` — hook into data stream to detect command start/end
3. Create `src/terminal/vitals/` module

## Comparison with Sidebar

| Feature | Sidebar | Bottom Bar Vitals |
|---------|---------|-------------------|
| Browse all containers | ✅ DockerView | ❌ |
| Switch K8s contexts | ✅ KubernetesView | ❌ |
| See what's running NOW | ❌ | ✅ Foreground process |
| Know command duration | ❌ | ✅ Duration timer |
| Memory usage warning | ❌ | ✅ Memory badge |
| Disk space alert | ❌ | ✅ Disk warning |
| SSH session awareness | ❌ | ✅ SSH badge |
| Root warning | ❌ | ✅ Root badge |

**Zero overlap. Purely complementary.**
