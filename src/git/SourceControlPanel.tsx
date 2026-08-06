import { useCallback, useEffect, useState } from "react";
import {
  isRepo,
  currentBranch,
  status,
  stageFile,
  unstageFile,
  commit,
  push,
  pull,
  fetch as gitFetch,
  diffFile,
  type GitFile,
} from "./client";
import { toast } from "../toast";
import { runInActiveTerminal } from "../ai/terminalContext";
import { Modal } from "../components/Modal";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Refresh01Icon,
  GitForkIcon,
  Bug01Icon,
  FolderCloudIcon,
  Download01Icon,
  Tick02Icon,
  FolderGitTwoIcon,
} from "@hugeicons/core-free-icons";

export function SourceControlPanel({
  onClose,
  inline,
  onOpenGitGraph,
  onOpenIssues,
}: {
  onClose?: () => void;
  inline?: boolean;
  onOpenGitGraph?: () => void;
  onOpenIssues?: () => void;
}) {
  const [repo, setRepo] = useState<boolean | null>(null);
  const [branch, setBranch] = useState("");
  const [files, setFiles] = useState<GitFile[]>([]);
  const [msg, setMsg] = useState("");
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await isRepo();
    setRepo(r);
    if (r) {
      setBranch(await currentBranch());
      setFiles(await status());
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast({
        title: "git error",
        message: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const doCommit = async () => {
    if (!msg.trim()) return;
    setBusy(true);
    try {
      await commit(msg.trim());
      toast({ title: "Committed", variant: "success" });
      setMsg("");
      await refresh();
    } catch (e) {
      toast({
        title: "Commit failed",
        message: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const showDiff = async (f: GitFile) => {
    setDiff({ path: f.path, text: await diffFile(f.path, f.staged) });
  };

  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => !f.staged);

  const commitShortcut =
    typeof navigator !== "undefined" && /Mac/.test(navigator.platform)
      ? "⌘↩"
      : "Ctrl+Enter";

  const openIssues = () => {
    if (onOpenIssues) {
      onOpenIssues();
    } else if (runInActiveTerminal("gh issue list")) {
      toast({ title: "Running: gh issue list", variant: "info" });
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  const openGraph = () => {
    if (onOpenGitGraph) {
      onOpenGitGraph();
    } else if (runInActiveTerminal("git log --oneline --graph --decorate -20")) {
      toast({ title: "Running: git log", variant: "info" });
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };


  const headerActions = (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label="GitHub Issues"
        title="GitHub Issues"
        onClick={openIssues}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon icon={Bug01Icon} size={16} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Git Graph"
        title="Git Graph"
        onClick={openGraph}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon icon={GitForkIcon} size={16} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Fetch"
        title="Fetch"
        disabled={busy}
        onClick={() => void act(gitFetch)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        <HugeiconsIcon icon={FolderCloudIcon} size={16} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Pull"
        title="Pull"
        disabled={busy}
        onClick={() => void act(pull)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        <HugeiconsIcon icon={Download01Icon} size={16} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Refresh"
        title="Refresh"
        onClick={() => void refresh()}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={1.5} />
      </button>
    </div>
  );

  return (
    <Modal
      icon={FolderGitTwoIcon}
      context={branch || undefined}
      title="Source control"
      onClose={onClose}
      inline={inline}
      headerActions={headerActions}
    >
      {repo === false ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={GitForkIcon} size={20} className="text-primary" />
          </div>
          <p className="text-[12px] font-medium text-foreground">Not a git repository</p>
          <p className="max-w-[180px] text-[11px] text-muted-foreground">
            Open a folder that's under git to see changes, stage files, and commit.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Commit box */}
          <div className="flex flex-col gap-1.5">
            <textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="Commit message"
              rows={2}
              className="w-full resize-none rounded-md bg-muted/30 px-2.5 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:ring-1 focus:ring-primary/30 box-border"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void doCommit();
                }
              }}
            />
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] text-primary">
                {staged.length === 0 ? "● Nothing staged" : `● ${staged.length} staged`}
              </span>
              <span className="text-[10px] text-muted-foreground">origin/{branch}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!msg.trim() || staged.length === 0 || busy}
                onClick={() => void doCommit()}
                className="h-7 flex-1 rounded-md bg-primary px-3 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                Commit
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(push)}
                className="h-7 flex-1 rounded-md bg-muted/40 px-3 text-[11px] font-semibold text-primary transition-colors hover:bg-muted/60 disabled:opacity-30"
              >
                Push
              </button>
            </div>
            <p className="px-0.5 text-[9px] text-muted-foreground/60">
              {commitShortcut} to commit
            </p>
          </div>

          {/* Staged */}
          {staged.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Staged ({staged.length})
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void act(async () => {
                      for (const f of staged) await unstageFile(f.path);
                    })
                  }
                  className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Unstage all
                </button>
              </div>
              <div className="flex flex-col gap-0.5">
                {staged.map((f) => (
                  <div
                    key={f.path}
                    className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-accent/10"
                  >
                    <button
                      type="button"
                      onClick={() => void act(() => unstageFile(f.path))}
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                      title="Unstage"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => void showDiff(f)}
                      className="min-w-0 flex-1 truncate text-left text-[11.5px] text-foreground transition-colors hover:text-primary"
                    >
                      {f.path}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unstaged */}
          {unstaged.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Changes ({unstaged.length})
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void act(async () => {
                      for (const f of unstaged) await stageFile(f.path);
                    })
                  }
                  className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  Stage all
                </button>
              </div>
              <div className="flex flex-col gap-0.5">
                {unstaged.map((f) => (
                  <div
                    key={f.path}
                    className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-accent/10"
                  >
                    <button
                      type="button"
                      onClick={() => void act(() => stageFile(f.path))}
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                      title="Stage"
                    >
                      +
                    </button>
                    <span
                      className={`shrink-0 rounded px-1 py-0 text-[9px] font-semibold leading-none ${
                        f.work === "?"
                          ? "bg-primary/15 text-primary"
                          : "bg-amber-500/15 text-amber-500"
                      }`}
                    >
                      {f.work === "?" ? "U" : f.work.trim() || "M"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void showDiff(f)}
                      className="min-w-0 flex-1 truncate text-left text-[11.5px] text-foreground transition-colors hover:text-primary"
                    >
                      {f.path}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {files.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary/15">
                <HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={2} className="text-primary" />
              </div>
              <p className="text-[12px] font-medium text-primary">Working tree clean</p>
              <p className="text-[11px] text-muted-foreground">on {branch}</p>
            </div>
          )}

          {diff && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {diff.path}
                </span>
                <button
                  type="button"
                  onClick={() => setDiff(null)}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Close
                </button>
              </div>
              <pre className="max-h-48 overflow-auto rounded-md border border-border/40 bg-muted/20 p-2 text-[10.5px] leading-relaxed text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {diff.text || "(no diff)"}
              </pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
