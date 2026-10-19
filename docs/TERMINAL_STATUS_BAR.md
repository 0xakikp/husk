# Adaptive terminal status bar

The bar follows the focused terminal leaf, not the remote-file-browser selection
or the app's default Kubernetes/Docker configuration. It shows observed command
state and duration, Local/Remote scope, and a known directory. Git appears only
for an observed local directory. Pending Git reads cannot publish into another
pane or remote scope. A remote path is never sent to the local Git client.

`Ready` requires a shell prompt observation. Without integration, the bar can
say `Shell open` or `Scope unverified`; missing metadata is not evidence of a
successful command or local shell. Connection failures take priority. A remote
target identifies observed terminal metadata/command intent, not proof of a
successful SSH authentication. Remote shells without prompt integration may
only expose the outer SSH command's lifetime, not commands typed inside it.

## Tools and optional details

- The bar shows small integration icons followed by useful target values, not
  tool-name inventory or unknown-value dashes. At an idle local prompt, relevant
  Kubernetes context/namespace and Docker context can be read from the focused
  terminal's reported configuration. For example: a Kubernetes icon followed
  by `staging / payments`, then a Docker icon followed by `orbstack`.
- During a running command, only unambiguous explicit selectors from that
  command qualify: a cloud icon with `dev`, for example. Hover or keyboard focus
  reveals the provider, selector type and provenance. Default configuration is
  not shown as the running command's target. Completed-command selectors remain
  in the menu, labelled `Last`; they never become a persistent active context.
- Pinning prioritizes meaningful target information and keeps the tool in the
  **Pinned** menu group. Unknown, ambiguous, disconnected or activity-only pins
  stay in the menu with an explanation; they do not add empty bar entries or
  inflate `+N`. Pinning Kubernetes/Docker also enables their local configuration
  reader at the next eligible prompt. Relevant observed tools enable it too.
- A tool appears once. The bar measures its actual remaining width and the
  rendered entries, including gaps and the overflow count. There is no fixed
  one/two/three-tool cap. `+N` appears only when meaningful entries cannot fit.
  Resizing, changing targets and loading fonts all recalculate the fit. These
  are focusable read-only inline indicators, not buttons; use `…` to manage pins
  or inspect all details.
- `…` groups **Pinned** tools, marked **Context priority**, separately from unpinned
  **Observed here** activity. A searchable **Add integration** catalog covers
  cloud, containers/VMs, infrastructure, development, connections, databases
  and other tools. It is a visibility catalog, not a list of installed tools.
  Pinning does not connect, install, refresh credentials or execute commands.
- Directly invoked CLIs without a target adapter show activity only: OpenTofu,
  DigitalOcean, database clients, package managers, tunnel tools and custom
  literal executable names. Shell builtins, simple housekeeping commands and
  nested shell/SSH payloads are not added as separate tools. This is command
  observation, not installed-tool discovery or a record of successful execution.
- Command-selected targets come from literal overrides, not verified
  connections. Nothing implies the override persists or the command succeeded.
  Conflicting or missing overrides across invocations of the same tool hide
  its bar entry, with `Mixed / unknown targets` explained in the menu.
  Commands outside the redaction helper's 480-character limit provide no tool
  display metadata.
- A pinned tool with no evidence says `Not observed here`. Up to 12 recent tool
  names are retained in memory per terminal/shell scope. After another command
  runs they say `Earlier activity`, without retaining previous selectors. SSH
  entry/exit, scope changes and fresh shells reset this list. Switching panes
  never shares observations. Unsupported aliases, script contents and dynamic
  shell expressions are not expanded or executed.
- Pin choices (including selected executable basenames) persist, but the tool
  display does not persist full commands, arguments, paths, hosts or target
  names. After reopening Husk, a pin remains in the menu; the bar waits for
  fresh command evidence or a newly resolved configuration in that terminal.
- CPU/memory and the clock live under `…`. Optional pinned metrics explicitly
  say `This computer`, including during remote sessions. Local metrics are
  polled only while requested; they never query a remote host.
- Narrow bars keep command state and scope, with secondary details in `…`.
  Memory values use GiB and remain explicitly local-machine information.

### Details menu layout

The menu shares the welcome page's hierarchy: a bold 18px title, lighter 12px
medium-weight tool names, larger 20px metric values, an accent-tinted border and a prominent
**Add integration** action. The 78%-opaque surface retains its 8px backdrop blur.
Text and controls remain fully opaque. Reduced
transparency, high-contrast settings or missing blur support use a solid surface.

The header identifies the focused terminal and provides **Logs** and **Copy path**.
Long paths are limited to two lines (one in short windows); hovering the path or
**Copy path** still shows the full path. Tool rows pair a name with its evidence on a second line, and
**Add integration** stays below the list. The footer keeps local CPU/memory and
the **Show in status bar** toggle accessible.

Only the tool list or catalog results scroll—not the whole popup. In the details
view, the identity header, Add integration action and local-machine footer stay
in place. In the catalog, search and navigation stay visible while browsing
results. The popup is 340px wide when space permits and is bounded by the available window height,
up to 600px. Search retains keyboard focus during pointer hover, and pin changes
preserve keyboard focus. Empty observed groups are omitted when pins already
fill the list. At the minimum window height, the header and local metrics use a
compact layout with smaller typography; the redundant Git row and explanatory captions are omitted to
leave room for scrolling tools and their actions. The path is available from
**Copy path** instead of a separate line, and compact tool rows omit section headings.

### Command-selected details

| Integration | Recognized literal selectors |
| --- | --- |
| Kubernetes / Helm | `--context` / `--kube-context` |
| Docker | `--context` (including an explicitly selected `orbstack` context) |
| AWS | `--profile` or command-local `AWS_PROFILE` |
| Terraform | Command-local `TF_WORKSPACE` |
| Oracle Cloud | `--profile`, `--region`, command-local `OCI_CLI_PROFILE` / `OCI_CLI_REGION` |
| Azure | `--subscription` name or ID |
| Google Cloud | `--project`, `--configuration`, command-local `CLOUDSDK_CORE_PROJECT` / `CLOUDSDK_ACTIVE_CONFIG_NAME` |
| OrbStack | `orb` / `orbctl` machine selector before the command payload |
| Podman | Global `--connection` / `-c` or command-local `CONTAINER_CONNECTION`; conflicting endpoint selectors are suppressed |
| Colima | `--profile` / `-p`; no inspection of `ssh` / `exec` payloads |
| Python / uv | `uv run --python` / `-p` or command-local `UV_PYTHON`; direct Python is activity only |
| Conda | `conda run --name` / `-n` or `--prefix` / `-p` before the nested command |
| SSH | Supplied destination and explicit `-p` port; never a resolved or authenticated endpoint |

These are requested values, not active-account or runtime discovery. Husk does
not inspect virtualenvs, resolve SSH configuration or assume Docker is using
OrbStack just because OrbStack was used earlier. Unsupported/ambiguous options produce activity-only details. Selector
flags in a nested program or remote payload are not interpreted as outer targets.
Legacy `cli:az`, `cli:oci`, etc. pins migrate to their richer adapter IDs without
duplicating menu rows.

### Per-terminal configuration

Husk shell integration emits private OSC 781 metadata before the completed
prompt: exported `KUBECONFIG`, a default kubeconfig path derived from that
shell's exported `HOME`, `DOCKER_CONFIG`, `DOCKER_CONTEXT`, and only the presence
of `DOCKER_HOST`. It never emits the Docker endpoint URL or a general environment
dump. Metadata is filtered from logs and AI output, retained only in memory,
and bound to the exact PTY, shell generation, local scope and directory.

For an active local terminal at a prompt, relevant readers run immediately and
refresh every five seconds while the window is visible, with at most one read
in flight per mounted bar. They recheck fresh
metadata before publishing. Typing a draft retains the context; Enter, command
execution, disconnection, scope changes or a new PTY invalidate it. New prompts
refresh even after an empty Enter. Focus/wake invalidates pending results.
An existing terminal must be reopened to load updated shell hooks. Prompt hooks
registered dynamically after Husk's Zsh hook can run after the capture; their
later environment changes are not guaranteed to be captured in that cycle.

- Kubernetes reads `current-context` and its namespace from the reported
  kubeconfig files, using first-file-wins merging and the terminal's cwd for
  relative paths. A valid selected context with no namespace displays `default`.
  Missing, malformed, unsupported or oversized configuration remains unresolved.
  YAML aliases/quoted values are supported; YAML merge keys fail closed with an
  explanation rather than displaying an incorrect default namespace.
- Docker uses an exported `DOCKER_CONTEXT` first. Otherwise an exported
  `DOCKER_HOST` suppresses the configured context, without disclosing its URL.
  Otherwise it reads `currentContext` from the reported Docker config directory.
  Missing selection does not invent `default`. `orbstack` appears only when
  actually selected as a Docker context, not merely because the OrbStack CLI
  was used or pinned.
- Configuration means **configured, not connected**. No cluster, daemon or
  account is queried. The bar never borrows Husk's process environment or its
  sidebar Kubernetes/Docker defaults. Remote and unverified shells are not
  inspected; explicit command selectors can still appear during remote runs.
  Other cloud adapters currently use command evidence, not automatic account
  discovery.

## Safety

Opening this bar/menu, pinning tools, or switching tabs does not execute shell,
SSH, cloud, container or development-environment probes. Local Git metadata still uses
the existing read-only local Git APIs. The new native reader opens only reported
configuration paths, bounds regular-file reads and parsing, and extracts only
context labels/namespaces. Files may contain credentials, but credential fields
are ignored; certificate/key references and credential helpers are never followed
or executed. Parser errors do not expose file contents. Kubernetes sidebar
source selection remains independent and unchanged.

The old app-global environment probes were also used by command warnings. Those
have been replaced with explicit command evidence: infrastructure-changing AI
commands still require review when the target is unknown. Known production-like
overrides can be named, but absence of such evidence is never proof of safety.
The terminal pilot retains its existing restricted command policy. This is not
a general shell parser or a security boundary for arbitrary scripts/aliases.

## Native-app smoke checks

1. Switch between two local panes with different directories and last results.
2. Enter SSH and return: local folder/Git must disappear immediately and must
   not return until fresh local metadata arrives. Check an integrated remote
   prompt and a remote shell without Husk integration.
3. Run an unpinned tool with an explicit context/profile: its value appears
   during the run, then disappears from the bar. The menu keeps `Last` details.
   Bare tool commands and conflicting compound overrides must not add automatic
   entries. Pinning that tool must not duplicate its current entry.
4. Pin Kubernetes and Docker in fresh local terminals with different exported
   config paths. At a prompt, verify context/namespace and selected Docker
   context. Type without Enter: values remain. Execute an override: only that
   command's target appears. Return to a prompt: configuration replaces the
   override, never a stale `Last` value. Change config externally and wait for
   refresh. Switch panes, enter SSH, disconnect and restart while reads are
   pending: old results must not reappear in another scope.
5. Reopen Husk with pins saved. Pins remain in **Pinned**, but old targets are
   not restored by this display. Unknown pins stay menu-only without a dash or
   overflow count. Unpin an observed tool: it moves to **Observed here**;
   relevant configured contexts can still appear automatically.
6. Run a compound command with several literal selectors and resize the bar.
   All should fit when actual space permits; only genuinely overflowing targets
   contribute to `+N`. Check a long target and changed font size. Indicators
   remain inline text, not buttons; hover and keyboard focus reveal provider,
   full target and provenance.
7. Open `…` with many tools, a long directory path and a short window. Only the
   tool list should scroll; the header, **Add integration** and local-metrics
   footer stay accessible. The full path remains available on hover. Inspect
   local metrics, close the menu, and check the narrow bar again.
8. From AI, request review of an infrastructure mutation without a known target;
   it must not bypass approval merely because no tool chip is visible.
9. Use **Add integration**, search for `oci`, `az`, `uv`, a category, and a name
   with spaces. Pin/unpin without the menu closing; arrows navigate results,
   Escape returns to details and then closes the menu. Scroll long results:
   search/navigation must stay visible. Check a short viewport.
10. Run a direct cloud command with an explicit selector: menu details must say
    `Current` / `Last`, never authenticated or connected. Run a different tool:
    the previous row becomes `Earlier activity` and loses its target details.
11. Run a custom CLI, Mosh or database client. Its name appears as activity only;
    credentials and nested commands must not become menu metadata. SSH scope
    changes clear the recent list. Unpinned generic tools stay in the menu;
   pinning one keeps truthful activity details in the menu without account/host queries.
