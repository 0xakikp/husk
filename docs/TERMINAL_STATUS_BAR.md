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

- The main bar never shows standalone tool names. Kubernetes, Docker, AWS and
  Terraform appear only during a running command with an explicit literal
  override, such as `K8s · context: staging` or `AWS · profile: dev`. Pins do not
  bypass this rule. On completion or disconnection, the badge disappears.
- Other directly invoked CLIs appear as activity details under `…` and can be
  pinned there: for example Azure, Google Cloud, Podman, OpenTofu, database tools,
  package managers, and custom literal executable names. These labels do not
  inspect or identify accounts, subscriptions, clusters or environments. Shell
  builtins, simple housekeeping commands and nested shell/SSH payloads are not
  added to the tool list. This is command observation, not installed-tool discovery.
- Named targets come only from literal overrides in that command, not verified
  connections. Completed-command details remain in the menu, labelled `Last`;
  nothing implies the override persists or the command succeeded. Conflicting
  or missing overrides across invocations of the same tool hide its bar badge.
  Commands outside the redaction helper's 480-character limit provide no tool
  display metadata.
- Unverified targets are identified as such in details. Unsupported aliases,
  scripts and dynamic shell expressions are not expanded or executed.
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
  Use `…` for details and pin settings; the menu is 280px wide when space permits.

## Safety

Opening this bar/menu, pinning tools, or switching tabs does not execute shell,
SSH, Kubernetes, Docker, AWS, or Terraform probes. Local Git metadata still uses
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
7. Run a direct `az`, `gcloud`, or custom CLI command. Its activity appears only
   in the menu without claiming an account or target; pin it, switch panes,
   then unpin it. No bare tool label should appear in the bar.
