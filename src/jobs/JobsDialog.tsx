import { useCallback, useEffect, useRef, useState } from "react";
import { bgSpawn, bgLogs, bgKill, bgRemove, bgList, type BgJob } from "./client";
import { getWorkspaceRoot } from "../workspace/store";
import { toast } from "../toast";
import { Modal } from "../components/Modal";
import { appendJobLogTail } from "./logTail";

export function JobsDialog({ onClose }: { onClose: () => void }) {
  const [jobs, setJobs] = useState<BgJob[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [log, setLog] = useState({ text: "", trimmed: false });
  const [cmd, setCmd] = useState("");
  const offsetRef = useRef(0);
  const listInFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const refresh = useCallback(() => {
    // A hung native response must not create a new request every 1.5 seconds.
    if (listInFlightRef.current) return;
    listInFlightRef.current = true;
    void bgList()
      .then((next) => { if (mountedRef.current) setJobs(next); })
      .catch(() => {})
      .finally(() => { listInFlightRef.current = false; });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const t = setInterval(refresh, 1500);
    return () => { mountedRef.current = false; clearInterval(t); };
  }, [refresh]);

  // Tail the selected job's output, incrementally by offset.
  useEffect(() => {
    if (selected === null) return;
    offsetRef.current = 0;
    setLog({ text: "", trimmed: false });
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const requestedOffset = offsetRef.current;
        const r = await bgLogs(selected, requestedOffset);
        if (!alive) return;
        offsetRef.current = r.next_offset;
        if (r.bytes || r.dropped > requestedOffset) {
          setLog((previous) => {
            const next = appendJobLogTail(previous.text, r.bytes);
            return { text: next.text, trimmed: previous.trimmed || next.trimmed || r.dropped > requestedOffset };
          });
        }
      } catch {
        // handle removed
      } finally {
        // Wait until this request settles before requesting another offset.
        // Overlapping polls can append the same bytes twice or out of order.
        if (alive) timer = setTimeout(() => void poll(), 1000);
      }
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
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
    <Modal title="Background jobs" onClose={onClose} className="jobs-modal">
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

          {selected !== null ? <>
            {log.trimmed ? <div className="jobs-log-note">Showing recent output; older output was omitted.</div> : null}
            <pre className="jobs-log">{log.text || "…"}</pre>
          </> : null}
    </Modal>
  );
}
