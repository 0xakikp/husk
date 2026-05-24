import { useCallback, useEffect, useRef, useState } from "react";
import { bgSpawn, bgLogs, bgKill, bgRemove, bgList, type BgJob } from "./client";
import { getWorkspaceRoot } from "../workspace/store";
import { toast } from "../toast";

export function JobsDialog({ onClose }: { onClose: () => void }) {
  const [jobs, setJobs] = useState<BgJob[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [log, setLog] = useState("");
  const [cmd, setCmd] = useState("");
  const offsetRef = useRef(0);

  const refresh = useCallback(() => {
    void bgList()
      .then(setJobs)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [refresh]);

  // Tail the selected job's output, incrementally by offset.
  useEffect(() => {
    if (selected === null) return;
    offsetRef.current = 0;
    setLog("");
    let alive = true;
    const poll = async () => {
      try {
        const r = await bgLogs(selected, offsetRef.current);
        if (!alive) return;
        offsetRef.current = r.next_offset;
        if (r.bytes) setLog((prev) => prev + r.bytes);
      } catch {
        // handle removed
      }
    };
    void poll();
    const t = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [selected]);

  const run = async () => {
    const c = cmd.trim();
    if (!c) return;
    try {
      const handle = await bgSpawn(c, getWorkspaceRoot() || null);
      setCmd("");
      setSelected(handle);
      refresh();
    } catch (e) {
      toast({ title: String(e), variant: "error" });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal jobs-modal" role="dialog" aria-label="Background jobs" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Background jobs</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="jobs-new">
            <input
              value={cmd}
              placeholder="Run in the background…  e.g. npm run dev"
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void run();
                }
              }}
            />
            <button type="button" className="rb-run" onClick={() => void run()} title="Run">
              ▶
            </button>
          </div>

          {jobs.length === 0 ? (
            <p className="rb-empty">No background jobs. Run one above — its output is captured here.</p>
          ) : (
            <div className="rb-list">
              {jobs.map((j) => (
                <div key={j.handle} className={`rb-item${selected === j.handle ? " active" : ""}`}>
                  <button type="button" className="jobs-pick" onClick={() => setSelected(j.handle)}>
                    <span className={`jobs-dot ${j.exited ? "off" : "on"}`} />
                    <span className="jobs-cmd">{j.command}</span>
                    <span className="rb-steps">
                      {j.exited ? `exited${j.exit_code != null ? ` (${j.exit_code})` : ""}` : "running"}
                    </span>
                  </button>
                  {!j.exited ? (
                    <button type="button" className="ai-icon" title="Stop" onClick={() => void bgKill(j.handle).then(refresh)}>
                      ■
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ai-icon"
                      title="Remove"
                      onClick={() => {
                        void bgRemove(j.handle).then(refresh);
                        if (selected === j.handle) setSelected(null);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {selected !== null ? <pre className="jobs-log">{log || "…"}</pre> : null}
        </div>
      </div>
    </div>
  );
}
