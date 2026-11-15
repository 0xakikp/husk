# Files and workspace search

## Choose the scope

Files shows its current folder and whether it is local or an SSH host. Local browsing starts at the open workspace; **Follow local terminal** is an explicit alternative. An SSH terminal's path is never used as a local folder. Changing hosts reloads that host's home folder instead of reusing the previous host's path.

The compact path row keeps the tree prominent. Its **Files options** (`…`) menu contains the folder mode, hidden-file toggle, Collapse all, and Reveal active file. SSH home reload and disconnect actions also live there.

The Files magnifier opens **Files / Contents** search beneath the displayed local folder. Results are recursive, including files inside collapsed folders. Filename results open the editor; content results open the matching line. Closing search clears its query and restores the tree.

The global launcher (`⌘/Ctrl K`) uses the same native search engine for `files:` and `content:` (also `grep:`). Its scope is the open workspace, shown in result paths—not the whole computer. Open editors also remain available in launcher results. No `fd`, `rg`, or Git installation is needed to search an ordinary local folder. Recursive SSH search is not implemented; remote browsing is labelled accordingly.

## Hidden files, ignores, and limits

- **Files options → Show hidden files** toggles dotfiles in the tree and Files search, and stays synchronized with Settings → General → `showHiddenFiles`. Dotfiles are visible by default when no choice is saved; an existing saved choice, including hiding them, is preserved.
- **Include ignored** is a separate search option. By default the native engine applies `.gitignore` and `.ignore` rules found inside the selected scope, plus that root's `.git/info/exclude`. It does not read ancestor ignore files outside that folder. Git metadata (`.git`) is always excluded from recursive search.
- Launcher search uses hidden/ignored exclusions by default. It does not silently expand into personal folders or remote hosts.
- Searches are cancellable and bounded by elapsed time, entries, depth, content bytes, and result count. Content search skips binary, oversized, and unsupported files. Symlinks are not followed by recursive search.
- Limits, skipped files, and unreadable locations are reported. Partial results are not presented as an exhaustive no-match result. Narrow the query or choose a smaller folder when a limit is reached.
- Search is local and does not send file contents to AI. The separate `code:` keyword index has its own bounded coverage; it invalidates after local file/repository changes and expires after a minute.

## Browse without losing your place

Refresh keeps expanded folders. Files reloads relevant entries after Husk file/repository changes and when the app regains focus. External changes made while Husk remains focused may need **Refresh**; this is not a continuously running disk watcher.

**Reveal active file** opens its parent folders, and **Collapse all** closes expanded folders. The tree supports arrow keys, Home/End, F2 to rename, and Shift+F10 for the context menu. Search and navigation controls remain above independently scrolling results/tree content.

## File-operation safety

Local **Move to Trash** is recoverable through the system Trash. Husk never silently falls back to permanent removal. macOS uses the system Foundation operation; Linux requires `gio trash`. If Trash is unavailable, use the system file manager. Windows Trash is not implemented in this version.

Remote deletion is explicitly labelled **permanent** and requires confirmation. Unsaved editor contents block destructive operations. Remote directory names use a structured NUL-framed format rather than parsing `ls`, preserving spaces, newlines, and symlink names.

Local creation and supported-platform renames refuse existing destinations atomically. Copy failures preserve any partial destination for inspection; cleanup never deletes a destination another process may have created. Safe remote create/copy/rename requires Python 3, with exclusive rename supported on Linux/macOS hosts. Unsupported hosts fail with an explanation instead of falling back to overwrite-prone commands. These protections are not transactions across arbitrary concurrent changes to an entire directory tree.
