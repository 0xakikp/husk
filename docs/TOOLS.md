# Tools and custom plugins

The sidebar **Tools** destination is a compact launcher grouped into Utilities (2FA Codes, Ports, Dev Tools) and Infrastructure (Kubernetes, Docker, Tailscale). Each row shows an icon and name; hover or keyboard-focus a row for its description. Custom plugin rows appear only after a folder is configured and contains definitions. Folder/setup information lives in **Tools options → Manage custom plugins…**, not in the launcher. Narrow sidebars keep 32px rail buttons and put excess destinations in **More**. Docker, Kubernetes, and Tailscale keep their parent Tools destination selected. Left/Right and Home/End navigate the rail; Enter/Space activate controls.

**Tools options → Check CLIs** checks local `kubectl` and `docker` executable presence only. The launcher shows **Unavailable** only for a missing CLI after a successful check; unchecked/present CLIs have no badge. A tooltip gives details, and failed checks show an error instead of marking every CLI missing. This does not establish cluster or Docker daemon connectivity. Those panels use Husk's local CLI configuration, not the active SSH terminal. Docker CLI configuration may itself point to a remote daemon. Tailscale is an API integration configured inside its panel, not a CLI installation check.

## Kubernetes: inspect, troubleshoot and learn

The Kubernetes browser runs local `kubectl`. **Config source** offers **App default**
(the app's inherited KUBECONFIG or home config), **Choose kubeconfig file…**, and
**Use active terminal config**. Explicit choices show the resolved paths and require
**Use config** confirmation before discovery. Only trust kubeconfigs you recognise:
their authentication plugins can execute local programs. Files are used in place;
Husk does not copy their contents, persist this source selection, or send it to AI.
Editing a selected file can change its cluster/authentication definitions; this is a
pinned path selection, not a frozen copy of file contents.

The terminal option captures exported KUBECONFIG paths at an empty, ready **local**
shell prompt; relative paths resolve against that terminal's directory. An unset or
empty export uses that terminal's reported home config, never an inferred app home.
Open a new local terminal after upgrading for shell integration support. SSH,
unsupported shells, busy prompts, and missing metadata fail closed with an
explanation; choose a local file instead. Only paths are captured—not other terminal
environment variables (such as AWS_PROFILE) or credentials. Authentication retains
the app's environment. Terminal tab changes never switch the selected source:
choose **Capture again** and confirm to update it.

**Authentication helpers:** on Unix, Kubernetes commands keep the app's executable
search path first and extend it with directories from a bounded login-shell PATH
probe. This lets GUI-launched Husk find helpers such as `aws`, `kubelogin` and
`gke-gcloud-auth-plugin`. Only the Kubernetes child process receives that PATH;
Husk does not import shell credentials, AWS profiles or kubeconfig variables.
Discovery loads user shell startup scripts once per app session for the app's shell
and discovery directory; both success and failure are cached to avoid repeated
startup side effects during polling. Restart Husk after changing shell PATH setup.
Missing helpers produce an actionable message; access checks remain **Unavailable**
with permissions explicitly not checked, and raw diagnostics stay under
**Technical details**. Husk does not install helpers or initiate a login flow.
An AWS profile exported only inside a terminal is still separate from the app's
authentication environment and any profile explicitly configured in the kubeconfig.

The context picker scopes
reads with explicit `--context`; it does **not** change the interactive terminal's
current context. Changing the browser source or context closes the current inspector.
A context removed from the selected config requires a new explicit choice. Related
resource links stay on the inspected source, context and namespace. Each inspector labels its
config paths and context; its Refresh button fetches a new snapshot. List caches are scoped by source, context
and namespace and revalidated after ten seconds. Permission errors, timeouts and
truncated results are not treated as empty successful reads.

**Namespace-restricted access:** the browser starts in the selected context's
configured namespace, or `default` when that context has no namespace configured.
This preference is read locally; namespace discovery does not have to succeed.
**Enter manually** accepts a namespace name without requiring permission to list
namespaces. **All namespaces** is an explicit choice, never the initial fallback.
Changing categories or refreshing keeps the user's selection; changing context or
config source resolves the new context's default. A failed default lookup asks for
a manual selection instead of querying all namespaces.

**Check access** runs bounded `kubectl auth can-i list` checks for the selected
category in the selected namespace/context/config source. When namespace discovery
fails, it also checks the separate, cluster-wide `list namespaces` permission;
that permission is optional for browsing a manually entered namespace. Results distinguish
Allowed, Not allowed, and Unavailable (including connection failures). Checks do
not grant permissions, read Secret contents, or prove resource existence, health,
or access to details/logs. Workloads and Config keep readable resource kinds visible
when another kind is denied, label partial results, and preserve the exact error.
Nothing changes the interactive shell's context or namespace preference.

Workload kinds are labelled in **Workloads**. A Pod's **Overview → Connections →
Owned by** shows direct owner references; Deployment-managed Pods normally point to
a ReplicaSet, whose Relationships section links to the Deployment. Pod list rows
also show the controlling workload's kind and name. Deployment labels are resolved
through a matching ReplicaSet owner UID, never inferred from Pod names. Other
controllers (including StatefulSets, DaemonSets and Jobs) are labelled directly.
If ReplicaSet reads are denied, the direct ReplicaSet owner remains visible; if
Pod ownership metadata is unavailable, readable Pods remain listed with an explicit
unavailable label. **No controller** means no controlling owner reference was
reported, not proof that no external system manages the Pod.

**Returning to Kubernetes:** use **Tools → Kubernetes** (or **… → Tools →
Kubernetes** on a narrow rail), or **Open Kubernetes** in the command palette.
These lead to the same sidebar view. Switching sections or collapsing the sidebar
preserves its source, context, namespace, category and scroll during this window's
lifetime. Unvisited tools are not mounted while collapsed, and hidden Docker polling
is paused. Selecting a specific palette context explicitly browses that context
from **App default**; it no longer changes kubectl's current context.

After closing or replacing an inspector, **Reopen last resource** appears in the
Kubernetes sidebar when its config source and context match the last inspection.
It identifies the resource and namespace, leaves list filters unchanged, and
fetches fresh details. Only one resource identity and its config paths are retained
in window memory—not resource contents, revealed Secrets or credentials. Restarting
the app clears this return history; a deleted or inaccessible resource reports a
fresh read error instead of displaying its old contents.

Kubernetes views use Husk's font family with a shared 13px body, 12px supporting
labels and 14px titles. Category navigation uses plain labels and a neutral
underline, without filled selection tiles. The Pod overview starts with reported
readiness, then independent columns for facts and related resources; narrow
inspectors stack them. Long diagnostic values wrap instead of disappearing behind
ellipses, and logs/YAML scroll within bounded reading areas. All-true standard
readiness conditions, labels and volumes stay available in collapsed sections;
false, unknown and non-readiness conditions open automatically. Optional check
failures such as unavailable metrics use an expandable notice with the exact error,
separate from a primary resource-read failure. These styles do not change terminal
or AI composer sizing. Containers use full-width cards; runtime details and probes
sit side by side only when the card has room, then stack in narrow inspectors.
Expanding a check notice keeps its header in place. Other inspectors use independent
adaptive sections without reserving a blank half-column for a lone section.

- **Health observations:** Pod summaries connect reported conditions, waiting reasons
  and current/previous terminations to evidence and a next check. Deployment,
  ReplicaSet, StatefulSet, DaemonSet, Service and PVC inspectors also explain relevant
  readiness or binding findings. These are local rules, not AI diagnoses or live
  application reachability checks. Historical OOM evidence is labelled as previous.
- **Relationships:** Follow Deployment → ReplicaSet → Pod, Pod → owner/Service,
  or Ingress → Service. Service details expand EndpointSlices, readiness and linked
  Pod backends. Matching Pods use real label selectors, including set expressions;
  matching labels alone do not establish ownership or network reachability.
- **Crash investigation:** The Pod Logs tab provides container selection (including
  init containers), current/previous instance, timestamps, local search and optional
  three-second refresh of the latest 200 lines. Requests do not overlap within a log
  view; hidden-document polling pauses. Previous-instance logs do not auto-refresh.
  Events and Logs include a collapsed termination/event timeline. Events may expire
  or be aggregated, and previous logs may be unavailable; this is not a historical
  logging service. These views do not persist log or event history.
- **Explain this:** Expand concept help beside probes, readiness, QoS, resource
  requests/limits, selectors, replica counts and PVCs. Explanations include the
  inspected values where applicable and a context-qualified read-only command.
  Reading explanations never executes that displayed command or contacts AI.
- **Secrets:** Overview shows key names only. YAML starts with an allowlisted,
  redacted projection that excludes values and annotations. **Reveal sensitive YAML**
  separately fetches raw YAML; **Hide**, leaving the tab, refreshing, switching
  resource/context/config source or closing the inspector clears it. Cancelling a pending reveal
  prevents late results from becoming visible. Base64 values are still sensitive.

### Kubernetes release checks

Use an authorised test cluster for native integration checks; the automated suite
uses mocked commands and must never contact a real cluster.

1. Open each workload kind. Confirm no blank inspectors, and unready workloads do not
   get healthy indicators merely because their current count equals the desired count.
2. Rapidly switch resources, namespaces and contexts while reads are delayed. Old
   results must not appear beneath the new identity. Check the inspector's context
   label and confirm the tool's picker leaves terminal `kubectl` context unchanged.
3. On a failing test Pod, follow **View evidence** and **Next check**. Toggle current/
   previous logs, containers, search and timestamps. Confirm the termination/event
   timeline and explicit unavailable messages for denied logs/events/metrics.
4. Inspect a Service with a selector that differs from the workload name. Follow its
   Pod links; verify empty matches differ from denied access. Exercise EndpointSlices
   with false and unspecified readiness and Services without selectors.
5. Open a test Secret's YAML. Verify redaction before reveal, then hide or navigate
   away during a delayed reveal. Sensitive content must not reappear. Do not use real
   credentials in screenshots, fixtures or automated tests.
6. Check light/dark themes and narrow inspectors, keyboard access to tabs and concept
   help, and that opening details adds no additional permanent AI column.
7. With two authorised kubeconfigs sharing a context name, switch sources while reads
   are delayed. Confirm lists, related resources, logs and Secret reveal remain scoped.
   Cancel a file/terminal preview and verify no cluster discovery uses that source.
8. In a new local shell, export a test KUBECONFIG, return to an empty prompt and capture
   it explicitly. Switch terminals and confirm the inspected source stays unchanged.
   Test merged/relative paths, unset exports, unavailable metadata and an SSH terminal.
9. With an account restricted to one namespace and denied namespace listing, verify
   its context namespace loads and manual entry works. Test invalid names, explicit
   All namespaces, delayed defaults, context/source changes and denied checks. An
   unavailable check must not be shown as a denial. Denying Secret listing must not
   hide readable ConfigMaps; denying one workload kind must not hide the others.
10. Browse a specific context/namespace/category, scroll, switch to Files, collapse
    and reopen the sidebar, then use **Open Kubernetes** in the palette. Verify the
    same view and scroll return without a separate dialog. Close an inspector and
    use **Reopen last resource**; verify a new fetch and redacted Secret defaults.
    Switch source/context and confirm an old cluster's return action is hidden.
11. Check Pod ownership for a Deployment, StatefulSet, DaemonSet, Job and unmanaged
    Pod. Deny ReplicaSet reads and verify a direct ReplicaSet label, not an inferred
    Deployment. A recreated ReplicaSet with a different UID must not resolve the
    old Pod reference. Explicit palette context selection should use **App default**
    without changing the interactive shell's kubectl current context.

## Remote files: explicit SSH/SFTP access

In **Remotes**, choose **Open SFTP** on a saved SSH connection or SSH-config alias.
For a manually started SSH shell, **Browse active SSH files…** reads the active
terminal's shell-integration command metadata locally. It only recognizes literal
SSH destinations and supported options; it never runs discovery commands or
connects just because a terminal looks remote. Custom wrappers, nested sessions,
remote commands and non-SSH logins require a separately configured SSH/SFTP target.
Kubernetes container browsing is not part of this feature.

The connection screen shows the intended target and authentication method.
**Connect & browse** explicitly opens a separate SFTP session and lists its
starting folder. It does not reuse the terminal's authenticated channel, sudo
privileges, remote directory, or terminal-only environment/agent. The server must
provide SSH and an SFTP subsystem, and its account permissions still apply. A
port-forwarded endpoint only works if it exposes SSH/SFTP; forwarding an arbitrary
service does not make its files browsable.

For an unverified server, authentication stops until the user independently checks
and confirms its fingerprint. A changed saved fingerprint is refused. Verified
fingerprints are stored in `sftp_verified_hosts.json` in Husk's app-data directory;
legacy automatically trusted records are not treated as human verification.
New SFTP password/passphrase inputs are transient and are not stored in tabs,
transfer records or saved profiles by this flow. This does not migrate existing
saved-connection storage.

The native resolver reads bounded user/system SSH config files without invoking
`ssh -G`, config commands, `Match exec`, or authentication plugins. Unsupported
jump/proxy/ControlMaster routing, required custom bind/crypto policy, and interactive
or MFA authentication fail explicitly rather than silently falling back to a
direct connection. Agent mode does not fall back to private-key files.
`IdentitiesOnly=yes` requires explicitly selecting key/password authentication.

Upload/download actions first show the remote identity and exact source and
destination. Existing files are protected unless **Allow replacing existing
files** is selected for that transfer. Folder transfers merge contents, and
file/folder or symbolic-link destination conflicts are refused. Copy/move,
rename, new-folder and delete are separate explicit actions; deleting a folder
requires a warning that includes its remote host/path. Browsing is read-only,
but these approved actions are **not** read-only and use the account's permissions.
There is no automatic synchronization or AI sharing.

Transfers use staging files; partial `.husk-…part` files can remain after a failure
or cancellation. Folder transfers are not atomic: files already copied remain.
The queue stores paths, public target metadata and state locally under
`huskv2.sftp.transferQueue`, not file contents or credentials. Closing/hiding the
SFTP view disconnects and pauses work; app-restored queued/running work is paused.
Reconnect and explicitly review **resume… / retry…** to continue. Replacement
approval is requested again. Removing a queue record does not remove partial files.

### SFTP release checks (disposable test host only)

1. Open a saved connection and a restored SFTP tab. Confirm there is no connection
   or file listing before **Connect & browse**. Check target/port/auth details.
2. On an unverified test host, compare the displayed fingerprint with a trusted
   source. Confirm unchecked verification cannot proceed and a changed key blocks
   authentication. Do not test identity bypasses against production hosts.
3. Try `ssh -p 2222 user@host` in a test terminal, switch to another terminal, then
   use **Browse active SSH files…**. Check it uses the selected terminal only and
   declines wrappers/nested/non-SSH commands. Confirm it does not reuse sudo/cwd.
4. Upload/download test files and folders. Cancel the review, then approve with
   overwrite off; existing files must stay unchanged. Repeat with explicit
   replacement and check only intended matching files change.
5. Pause, leave the view, reopen, and restart the app with saved work. No saved work
   should resume automatically. Review the source/destination again before resume.
6. Test a missing SFTP subsystem, denied directory, unavailable agent, unsupported
   jump host and MFA requirement. Expect actionable errors without alternate routing.

## Load a custom tool

1. Choose **Tools options → Manage custom plugins… → Choose folder**. Use **Back to tools** to return to the compact launcher.
2. Select a local folder containing JSON plugin definitions. Invalid files remain visible with an error. Unreadable folders have a retry action and are not reported as empty.
3. Open a plugin and review its exact command and local workspace path. Opening it does not run anything. **Run view locally** authorizes that command in that workspace for this open panel.
4. Refresh manually, or explicitly opt into the plugin's suggested auto-refresh interval. Switching views, changing workspace, reloading definitions, or closing the tool revokes the corresponding view consent. Hiding a tool/window pauses auto-refresh and invalidates in-flight results. Returning to a previously authorized visible tool resumes an opted-in timer; stale rows remain unavailable for actions until refreshed.
5. **Manage custom plugins… → Reload plugins** reloads definitions. **Clear folder selection** only clears the saved folder preference; it does not delete files. The launcher shows **Plugin setup · Needs attention** if definitions fail to load; open it for the full error and recovery controls.

Example `files.json`, using the macOS/Linux `ls` executable:

```json
{
  "name": "Workspace files",
  "description": "List entries and review a metadata command",
  "brand": "#4A90D9",
  "views": [
    {
      "title": "Files",
      "command": "ls -1",
      "format": "lines",
      "actions": [
        { "label": "File metadata", "command": "ls -ld -- '{Output}'" }
      ]
    }
  ]
}
```

Views support `lines`, whitespace-aligned `table` (header and cells separated by at least two whitespace characters), and `json` (objects with scalar fields or scalar rows). JSON is preferable when values contain whitespace. `columns` optionally selects exact JSON/table column names. Nested JSON fields are not exposed to actions. An optional `refresh` from 2 to 86,400 seconds only suggests an interval; it does not authorize polling.

## Execution and trust

Custom plugins are **not sandboxed extensions**. A view is an arbitrary local executable and can modify files, contact networks, launch processes, or affect services. Only run definitions from authors you trust. Husk does not send custom-tool data to AI automatically.

Commands use simple literal program-and-argument syntax, with single/double quotes for grouping. Pipes, redirects, shell expansions, globs, empty quoted arguments, and control characters are rejected rather than silently reinterpreted. Executables must be literal names/paths. Row actions insert `{Column}` values as shell-quoted literal arguments; missing fields are errors. Interpreter/dispatcher templates with row placeholders are rejected. Quoting is not a guarantee that a command is harmless: the selected program can interpret arguments as options or code. Always review the final command.

Row actions first open a frozen preview with **Copy command**, **Stage only**, and **Close preview**. The legacy `run: true` field is accepted for compatibility but never executes the action. Staging requires a verified local terminal in the same directory, an empty idle prompt, and the same terminal/connection identity at write time. SSH, changed targets, busy/unknown prompts, partial output, and stale data are rejected. Staging never presses Enter. Shell integration is needed to verify prompt state; when unavailable, copy and manually review instead.

Docker terminal actions and Ports' curl action also stage into verified local prompts instead of running immediately. Tailscale's **Stage SSH command** prepares a connection command in a local prompt. Check the terminal's CLI context/environment before executing: Husk's subprocess environment and your interactive shell environment may differ.

**Stop waiting** discards results and disables that view's auto-refresh; it is not immediate process cancellation. A command already started may keep running until its 20-second execution deadline (binary resolution can add up to 3 seconds). The native runner terminates/reaps the direct process at timeout and kills its isolated process group on Unix. Programs that deliberately detach/escape the process group are not contained; Windows cleanup covers the direct child. Timed-out or truncated native output is never used for row actions.

Limits: 100 JSON files per folder, 128 KiB per definition, 20 views, 20 actions per view, 64 columns, 8,000 UTF-8 bytes per authored command and cell, and 200 displayed rows. Native stdout and stderr are each capped at 256 KiB. Additional rows are clearly marked partial with actions disabled. Commands are never silently shortened. The shared terminal staging path has a stricter 2,000-character command limit. Plugin definitions remain on disk; the folder preference is saved in Husk settings, while execution consent and displayed rows are not persisted.

## Desktop release checks

- Switch light/dark themes and narrow/widen the rail. Verify Tools parent selection, More menu, tooltip readability, keyboard navigation, and full-size targets.
- Test no folder, empty folder, denied/missing folder, invalid JSON, oversized files, duplicate columns and unsafe templates. Switch folders while a load is pending; old results must not reappear. Reload a modified definition and verify renewed consent.
- Open a custom plugin without running it. No view command should execute. After consent, change views/workspace while a request is pending; no old rows or actions should carry over.
- Enable auto-refresh, then hide the panel/window. No new requests should start. Slow commands must not overlap within the open panel; refresh failures must show stale data, not a fabricated empty list.
- Preview an action containing spaces, quotes, or shell metacharacters in a row value. Verify exact quoted output, copy/close behavior, and stage without Enter. Repeat with SSH, a different cwd, a changed terminal, a busy prompt and an existing draft; staging must fail closed.
- Check Docker hidden-window polling, failed refresh/retry, and Stage logs/inspect/shell. Confirm there is no accidental execution on opening a custom tool or inspecting a row.
- Run long/noisy command fixtures and confirm native timeout cleanup and bounded output. Automated tests cover these paths, but live Tauri, terminal integration, accessibility, Windows, and service-specific smoke tests remain release requirements.
