import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Alert02Icon } from "@hugeicons/core-free-icons";
import { cn } from "../lib/utils";
import { formatKb, totalBytes, type AiContextItem } from "./contextItems";
import { loadMcpServers } from "../mcp/store";
import type { RemoteWorkspaceScope } from "./remoteWorkspace";

export type ContextInspectorTools = {
  /** e.g. "gpt-5.2" — the model the request would go to. */
  modelLabel: string;
  providerLabel: string;
  /** API and signed-in providers use the same Husk action policy. */
  providerKind: string;
  fileToolsEnabled: boolean;
  mcpToolsEnabled: boolean;
  workspacePath?: string;
  remoteWorkspace?: RemoteWorkspaceScope;
};

/**
 * The Context Inspector: a compact sheet over the composer showing exactly
 * what the AI can see before a prompt is sent. It is deliberately not a modal
 * — the chat stays mounted behind it, Escape/Done returns focus to the
 * composer, and nothing here asks for a blocking decision.
 */
export function ContextInspector({
  items,
  budgetKb,
  tools,
  onRemove,
  onClearAll,
  onClose,
}: {
  items: AiContextItem[];
  budgetKb: number;
  tools: ContextInspectorTools;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [mcpServers] = useState(() => loadMcpServers());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    /* Capture, so the composer's own Escape-to-close does not also fire. */
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const total = totalBytes(items);
  const over = total > budgetKb * 1024;
  const enabledServers = mcpServers.filter((s) => s.enabled);

  return (
    <div className="ctx-inspector" role="dialog" aria-label="AI context inspector">
      <div className="ctx-inspector-head">
        <span className="ctx-inspector-title">AI CONTEXT</span>
        <span className={cn("ctx-inspector-total", over && "ctx-inspector-over")}>
          {formatKb(total)} / {budgetKb} KB · {items.length} item{items.length === 1 ? "" : "s"} attached
        </span>
        <button type="button" onClick={onClose} className="composer-icon-btn" title="Close inspector">
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </button>
      </div>

      <div className="ctx-inspector-body">
        {items.length === 0 ? (
          <div className="ctx-inspector-empty">
            No context attached. The AI will only see your message and its instructions.
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="ctx-inspector-item-wrap">
              <div className="ctx-inspector-item">
                <span className="ctx-inspector-icon">{item.icon}</span>
                <div className="ctx-inspector-label">
                  <span className="ctx-inspector-name" title={item.source}>
                    {item.label}
                  </span>
                  {item.sensitive && (
                    <span
                      className="ctx-inspector-sensitive"
                      title={`May contain: ${item.sensitiveReasons.join(", ")}`}
                    >
                      <HugeiconsIcon icon={Alert02Icon} size={9} strokeWidth={2} />
                      {item.sensitiveReasons[0]}
                    </span>
                  )}
                </div>
                <span className="ctx-inspector-bytes">{formatKb(item.bytes)}</span>
                <button
                  type="button"
                  className="ctx-inspector-act"
                  onClick={() => setPreviewId((id) => (id === item.id ? null : item.id))}
                >
                  {previewId === item.id ? "hide" : "preview"}
                </button>
                {item.removable ? (
                  <button type="button" className="ctx-inspector-act ctx-inspector-remove" onClick={() => onRemove(item.id)}>
                    remove
                  </button>
                ) : (
                  <span className="ctx-inspector-fixed" title="Changed in Settings → Agents">fixed</span>
                )}
              </div>
              {previewId === item.id && (
                <pre className="ctx-inspector-preview">{item.preview || "(empty)"}</pre>
              )}
            </div>
          ))
        )}

        <div className="ctx-inspector-tools">
          <div className="ctx-inspector-tools-title">TOOLS</div>
          <div className="ctx-inspector-tool-row">
            <span className="ctx-inspector-tool-name">Model</span>
            <span className="ctx-inspector-tool-state">
              {tools.providerLabel} · {tools.modelLabel}
              {tools.providerKind === "cli" ? " · subscription · Husk actions" : " · API · Husk actions"}
            </span>
          </div>
          <div className="ctx-inspector-tool-row">
            <span className="ctx-inspector-tool-name">File tools</span>
            <span className="ctx-inspector-tool-state">
              {tools.fileToolsEnabled
                ? tools.remoteWorkspace
                  ? `SSH · ${tools.remoteWorkspace.host}:${tools.remoteWorkspace.path}`
                  : tools.workspacePath
                  ? `enabled · ${tools.workspacePath}`
                  : "select a workspace first"
                : "disabled"}
            </span>
          </div>
          {enabledServers.length > 0 ? (
              enabledServers.map((s) => (
                <div key={s.id} className="ctx-inspector-tool-row">
                  <span className="ctx-inspector-tool-name">{s.name}</span>
                  <span className="ctx-inspector-tool-state">
                    {tools.mcpToolsEnabled ? "connected" : "disabled"}
                    {s.readOnly ? " · read-only" : ""}
                  </span>
                </div>
              ))
            ) : (
              <div className="ctx-inspector-tool-row">
                <span className="ctx-inspector-tool-name">MCP</span>
                <span className="ctx-inspector-tool-state">no integrations configured</span>
              </div>
            )}
        </div>
      </div>

      <div className="ctx-inspector-foot">
        <button
          type="button"
          className="ctx-inspector-foot-btn ctx-inspector-clear"
          onClick={onClearAll}
          disabled={items.every((i) => !i.removable)}
        >
          Clear all
        </button>
        <button type="button" className="ctx-inspector-foot-btn ctx-inspector-done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
