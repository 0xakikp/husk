# Git workflows in Husk

Husk uses the repository's normal Git index, branches, remotes and stashes. There is no separate “Husk staging” system. **Staging selects saved changes for the next commit.** Unstaging removes that selection without deleting your edits. A commit records the index; a push shares commits with a remote.

## A daily workflow

1. Click the branch name to create or switch branches. Save editor buffers and commit or stash working-tree changes first. Branches checked out in another worktree cannot be switched to here.
2. Review files under **Changes**. The diff colors additions/removals and displays old/new line numbers. **Open file** uses Husk's local editor; **Expand diff** opens a larger review surface.
3. Stage related files, or choose **Stage hunk** for an individual text change. Partially staged files appear under both **Staged** and **Changes**, each showing the appropriate side.
4. Enter a message and **Commit staged**. Unsaved editor text is not part of a Git diff or commit until saved.
5. **Review outgoing** commits before pushing. On a new branch, **Publish branch** asks for the remote and destination and requires review before pushing and configuring its upstream.
6. Use **Fetch** to update remote-tracking records. **Review incoming** shows the locally known incoming commits. **Pull** only fast-forwards a clean working tree; it never silently rebases, merges divergent history, or auto-stashes.

Ahead/behind counts and comparisons reflect the last fetch, not a continuous remote connection. Local refresh does not contact the network. History and directional reviews support inspecting commit patches; merges are compared against the first parent in commit history.

## Stashes and conflicts

Under **⋯ → Stashes**, save tracked changes with an optional message. Including untracked files is an explicit choice; those files can contain secrets. Ignored files and nested submodule work are not saved. Stashes remain local Git objects, not encrypted vault records.

Inspect a stash before **Apply & keep stash**. Husk requires a clean working tree and keeps the stash after applying; conflicts may still require resolution. There is no automatic pop/drop or destructive cleanup.

For conflicts, compare the base and index sides, open the working file in the editor, resolve its content and save. Confirm the review before **Mark resolved**, which stages that file. “Ours” and “theirs” are Git's index roles, not instructions to blindly choose a side. Husk does not overwrite files with one side automatically.

Git worktree operations are blocked when Husk knows of unsaved editor buffers. Clean open local tabs are refreshed after Git operations; edits made while a refresh is pending are preserved. Changes made by Git commands outside this panel may still require reopening the file.

## Hosted reviews

**⋯ → Pull / merge request** identifies supported hosts from local remote configuration. Merely opening the panel makes no authenticated network request.

- GitHub.com: **Load review status** uses the existing signed-in `gh` CLI to read the current branch's pull request, review decision and checks. Missing access, errors and pending/failed checks are shown distinctly; “no checks” is not a passing result.
- GitLab.com: open the merge-request list or prepare a browser form for the branch. In-app GitLab review/check status is not connected.
- Unknown/custom enterprise hosts and SSH aliases: no provider is guessed. Local Git still works; use the provider website until an adapter is configured.

Preparing a browser form does not submit a PR/MR. Publish the branch first and verify its base/target in the provider's form. Husk neither installs a CLI nor signs into an account automatically. No source diff is sent to AI by these Git features.

## Safety boundaries and limits

- Native argv and literal path handling; no shell-string execution for Git actions.
- Push/publish targets one explicitly chosen branch; no force, matching-branch or automatic tag push.
- Branch and repository identity are checked again before writes. Publish rechecks the reviewed push addresses.
- Hunk staging supports bounded, complete UTF-8 diffs of ordinary tracked text modifications. Binary files, renames, mode changes, symlinks, conflicts and unsupported filenames use whole-file staging or the terminal.
- Native hunk staging holds the index lock, verifies the complete reviewed diff, derives the selected patch itself and applies it to a private index before atomic replacement. It does not edit the working file. Stale reviews and existing locks are rejected, not bypassed.
- Commit history, diffs and review lists are bounded. Truncation/limits are disclosed. Provider calls and Git commands have timeouts; an interrupted mutation may have completed, so refresh before retrying.
- Git can run locally configured commit hooks, signing tools and credential helpers during normal explicit operations. No reset, discard, force-push, automatic conflict choice or stash deletion button is provided.
