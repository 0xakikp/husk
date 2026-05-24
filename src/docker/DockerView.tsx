import { useCallback, useEffect, useState } from "react";
import {
  checkDocker,
  listContainers,
  listImages,
  startContainer,
  stopContainer,
  removeContainer,
  type DockerContainer,
  type DockerImage,
} from "./client";
import { toast } from "../toast";

export function DockerView({ onClose }: { onClose: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const ok = await checkDocker();
      setAvailable(ok);
      if (ok) {
        setContainers(await listContainers().catch(() => []));
        setImages(await listImages().catch(() => []));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const action = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      toast({ title: label, variant: "success" });
      await refresh();
    } catch (e) {
      toast({
        title: "Docker error",
        message: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal docker-modal" role="dialog" aria-label="Docker" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Docker</span>
          <span className="modal-head-actions">
            <button type="button" className="ai-icon" title="Refresh" onClick={() => void refresh()}>
              ⟳
            </button>
            <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
              ×
            </button>
          </span>
        </div>
        <div className="modal-body">
          {available === false ? (
            <p className="rb-empty">Docker isn't on your PATH. Start Docker and refresh.</p>
          ) : loading && containers.length === 0 ? (
            <p className="rb-empty">Loading…</p>
          ) : (
            <>
              <div className="dv-section">Containers</div>
              {containers.length === 0 ? (
                <p className="rb-empty">No containers.</p>
              ) : (
                containers.map((c) => (
                  <div key={c.id} className="rb-item">
                    <span className={`dv-dot ${c.state === "running" ? "dv-on" : "dv-off"}`} />
                    <div className="rb-meta">
                      <span className="rb-name">{c.name}</span>
                      <span className="rb-steps">
                        {c.image} · {c.status}
                      </span>
                    </div>
                    {c.state === "running" ? (
                      <button
                        type="button"
                        className="ai-icon"
                        title="Stop"
                        onClick={() => action(() => stopContainer(c.id), `Stopped ${c.name}`)}
                      >
                        ⏸
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ai-icon"
                        title="Start"
                        onClick={() => action(() => startContainer(c.id), `Started ${c.name}`)}
                      >
                        ▶
                      </button>
                    )}
                    <button
                      type="button"
                      className="ai-icon"
                      title="Remove"
                      onClick={() => action(() => removeContainer(c.id), `Removed ${c.name}`)}
                    >
                      🗑
                    </button>
                  </div>
                ))
              )}

              <div className="dv-section">Images</div>
              {images.length === 0 ? (
                <p className="rb-empty">No images.</p>
              ) : (
                images.map((im) => (
                  <div key={`${im.id}-${im.tag}`} className="rb-item">
                    <div className="rb-meta">
                      <span className="rb-name">
                        {im.repo}:{im.tag}
                      </span>
                      <span className="rb-steps">
                        {im.size} · {im.created}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
