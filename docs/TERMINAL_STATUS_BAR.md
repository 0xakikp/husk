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

- The main bar never shows standalone tool names. It shows at most two tools
  during a running command with an explicit literal selector, such as
  `K8s · context: staging`, `AWS · profile: dev`, or `Azure · subscription: demo`.
  Additional selectors are available in the tooltip and details menu. Pins do
  not bypass this rule. On completion or disconnection, the badge disappears.
- `…` groups **Pinned** tools separately from **Observed here**. A searchable
  **Add integration** catalog covers cloud, containers/VMs, infrastructure,
  development, connections, databases and other tools. It is a visibility
  catalog, not a list of installed tools. Pinning does not connect, install,
  refresh credentials or execute commands.
- Directly invoked CLIs without a target adapter show activity only: OpenTofu,
  DigitalOcean, database clients, package managers, tunnel tools and custom
  literal executable names. Shell builtins, simple housekeeping commands and
  nested shell/SSH payloads are not added as separate tools. This is command
  observation, not installed-tool discovery or a record of successful execution.
- Named targets come only from literal overrides in that command, not verified
  connections. Completed-command details remain in the menu, labelled `Last`;
  nothing implies the override persists or the command succeeded. Conflicting
  or missing overrides across invocations of the same tool hide its bar badge.
  Commands outside the redaction helper's 480-character limit provide no tool
  display metadata.
- A pinned tool with no evidence says `Not observed here`. Up to 12 recent tool
  names are retained in memory per terminal/shell scope. After another command
  runs they say `Earlier activity`, without retaining previous selectors. SSH
  entry/exit, scope changes and fresh shells reset this list. Switching panes
  never shares observations. Unsupported aliases, script contents and dynamic
  shell expressions are not expanded or executed.
- Pin choices (including selected executable basenames) persist, but full commands,
  arguments, paths, hosts, and target names do not. Pins keep items at the top of
  the details menu; they never force an idle/unknown tool label into the bar.
- CPU/memory and the clock live under `…`. Optional pinned metrics explicitly
  say `This computer`, including during remote sessions. Local metrics are
  polled only while requested; they never query a remote host.
- Narrow bars keep command state and scope, with secondary details in `…`.
- The compact menu uses Husk's black/elevated theme surface, rounded rows, subtle
  accent focus, keyboard navigation and viewport-limited scrolling. Native memory
  values are converted from bytes to MiB and displayed in GiB.
- Tool names in the bar are read-only inline indicators, not action buttons.
  Use `…` for details and pin settings; the menu is 340px wide when space permits,
  with 12px outer padding, 48px tool rows and a viewport-limited 600px height cap.
  A padded identity header pairs Logs/Copy path actions, followed by a bordered
  tools section with two-line status rows and an Add integration action. Empty
  observed groups are omitted when pins already fill the list. A separate
  footer presents local CPU/memory values and the optional bar toggle. Search
  keeps focus during pointer hover, pin changes preserve keyboard focus, and
  long menus remain scrollable within the available window height.
  The popup surface is 88% opaque with a light 8px backdrop blur; text and
  controls remain fully opaque. Without blur support, or when reduced
  transparency/high contrast is requested, the surface stays solid.

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
not read inherited shell environment variables, inspect virtualenvs, resolve SSH
configuration or assume Docker is using OrbStack just because OrbStack was used
earlier. Unsupported/ambiguous options produce activity-only details. Selector
flags in a nested program or remote payload are not interpreted as outer targets.
Legacy `cli:az`, `cli:oci`, etc. pins migrate to their richer adapter IDs without
duplicating menu rows.

## Safety

Opening this bar/menu, pinning tools, or switching tabs does not execute shell,
SSH, cloud, container or development-environment probes. Local Git metadata still uses
the existing read-only local Git APIs. No environment dump or credential read
was added. Kubernetes sidebar source selection remains independent and unchanged.

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
3. Run a direct tool command with an explicit context/profile: its value appears
   during the run, then disappears from the bar. The menu keeps `Last` details.
   Bare tool commands and conflicting compound overrides must not add badges.
4. Pin a tool, change tabs and reopen Husk. The menu retains the pin; the idle
   bar stays clean. Target names are not persisted.
5. Open `…`, inspect local metrics, close it, and check a narrow window.
6. From AI, request review of an infrastructure mutation without a known target;
   it must not bypass approval merely because no tool chip is visible.
7. Use **Add integration**, search for `oci`, `az`, `uv`, a category, and a name
   with spaces. Pin/unpin without the menu closing; arrows navigate results,
   Escape returns to details and then closes the menu. Check a short viewport.
8. Run a direct cloud command with an explicit selector: menu details must say
   `Current` / `Last`, never authenticated or connected. Run a different tool:
   the previous row becomes `Earlier activity` and loses its target details.
9. Run a custom CLI, Mosh or database client. Its name appears as activity only;
   credentials and nested commands must not become menu metadata. SSH scope
   changes clear the recent list. No bare tool label appears in the bar.
