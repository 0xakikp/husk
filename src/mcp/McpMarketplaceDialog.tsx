import { useMemo, useState } from "react";
import { MARKETPLACE, type McpCatalogItem } from "./marketplace";
import { addMcpServer } from "./store";

export function McpMarketplaceDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [q, setQ] = useState("");

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return MARKETPLACE;
    return MARKETPLACE.filter((i) =>
      `${i.name} ${i.description} ${i.category}`.toLowerCase().includes(query),
    );
  }, [q]);

  const add = (item: McpCatalogItem) => {
    addMcpServer({
      name: item.name,
      command: item.command,
      args: item.args,
      env: item.env,
      enabled: true,
    });
    onAdded();
    onClose();
  };

  const needsConfig = (item: McpCatalogItem) =>
    item.args.some((a) => a.includes("{{")) ||
    Object.values(item.env).some((v) => v === "");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="MCP catalog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>MCP catalog</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <input
            className="setting-input"
            style={{ width: "100%" }}
            placeholder="Search servers…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="rb-list">
            {items.map((item) => (
              <div key={item.id} className="rb-item">
                <div className="rb-meta">
                  <span className="rb-name">
                    {item.name}
                    <span className="mcp-cat">{item.category}</span>
                  </span>
                  <span className="rb-steps">{item.description}</span>
                  {needsConfig(item) ? (
                    <span className="mcp-needs">needs a value — edit after adding</span>
                  ) : null}
                </div>
                <button type="button" className="rb-run" title="Add" onClick={() => add(item)}>
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
