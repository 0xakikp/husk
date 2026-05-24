import { useEffect, useState } from "react";

const IMG_RE = /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif)$/i;

function toSrc(raw: string): string {
  let u = raw.trim();
  if (u.startsWith("/")) u = `file://${u}`;
  else if (!/^https?:\/\//.test(u) && !u.startsWith("file://")) u = `https://${u}`;
  return u;
}

export function PreviewDialog({
  onClose,
  initialPath,
}: {
  onClose: () => void;
  initialPath?: string;
}) {
  const [url, setUrl] = useState(initialPath ?? "");
  const [src, setSrc] = useState("");

  useEffect(() => {
    if (initialPath && initialPath.trim()) setSrc(toSrc(initialPath));
  }, [initialPath]);

  const go = () => {
    if (!url.trim()) return;
    setSrc(toSrc(url));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal diff-modal" role="dialog" aria-label="Preview" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Preview</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="preview-bar">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go();
            }}
            placeholder="URL or file path (e.g. example.com, /path/to/index.html)"
          />
          <button type="button" className="primary" onClick={go}>
            Go
          </button>
        </div>
        <div className="preview-host">
          {!src ? (
            <div className="rb-empty">Enter a URL or file path to preview.</div>
          ) : IMG_RE.test(src) ? (
            <img className="preview-img" src={src} alt="preview" />
          ) : (
            <iframe className="preview-frame" src={src} title="preview" />
          )}
        </div>
      </div>
    </div>
  );
}
