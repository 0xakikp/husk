import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  TickDouble01Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons";
import { usePrefs, setPrefs, type AiAgent } from "./preferences";
import { SectionHeader } from "./components/SectionHeader";
import { cn } from "@/lib/utils";

function nextId() {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

const BUILT_IN_IDS = new Set(["architect", "code", "ask", "debug", "orchestrator"]);

export function AiAgentsSection() {
  const p = usePrefs();
  const [editing, setEditing] = useState<AiAgent | null>(null);
  const [form, setForm] = useState({ name: "", icon: "", systemPrompt: "" });
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const agents = p.aiAgents ?? [];

  const save = () => {
    if (!form.name.trim() || !form.systemPrompt.trim()) return;
    const item: AiAgent = {
      id: editing?.id ?? nextId(),
      name: form.name.trim(),
      icon: form.icon.trim() || "🤖",
      systemPrompt: form.systemPrompt.trim(),
      builtIn: editing?.builtIn ?? false,
    };
    const existing = agents;
    const next = editing
      ? existing.map((a) => (a.id === editing.id ? item : a))
      : [...existing, item];
    setPrefs({ aiAgents: next });
    reset();
  };

  const reset = () => {
    setEditing(null);
    setForm({ name: "", icon: "", systemPrompt: "" });
    setShowForm(false);
  };

  const startEdit = (a: AiAgent) => {
    setEditing(a);
    setForm({ name: a.name, icon: a.icon, systemPrompt: a.systemPrompt });
    setShowForm(true);
  };

  const duplicate = (a: AiAgent) => {
    const copy: AiAgent = {
      ...a,
      id: nextId(),
      name: `${a.name} Copy`,
      builtIn: false,
    };
    setPrefs({ aiAgents: [...agents, copy] });
  };

  const remove = (id: string) => {
    const next = agents.filter((a) => a.id !== id);
    setPrefs({ aiAgents: next });
    if (p.activeAgentId === id) {
      const fallback = next.find((a) => a.id === "code") || next[0];
      if (fallback) setPrefs({ activeAgentId: fallback.id });
    }
  };

  const setActive = (id: string) => {
    setPrefs({ activeAgentId: id });
  };

  const copyPrompt = (a: AiAgent) => {
    void navigator.clipboard.writeText(a.systemPrompt).then(() => {
      setCopiedId(a.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="AI Agents"
        description="Personas that define how the AI composer behaves. Predefined agents can be edited, and you can add custom ones."
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <div
            key={a.id}
            onClick={() => setActive(a.id)}
            className={cn(
              "group relative flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors",
              p.activeAgentId === a.id
                ? "border-primary/60 bg-primary/10"
                : "border-border/40 bg-muted/20 hover:border-border/70 hover:bg-muted/30",
            )}
          >
            <div className="flex items-start gap-2">
              <span className="text-[18px] leading-none">{a.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium text-foreground">
                    {a.name}
                  </span>
                  {a.builtIn && (
                    <span className="rounded bg-primary/10 px-1 py-0 text-[9px] text-primary">
                      Built-in
                    </span>
                  )}
                  {p.activeAgentId === a.id && (
                    <span className="ml-auto rounded bg-emerald-500/15 px-1 py-0 text-[9px] text-emerald-400">
                      Active
                    </span>
                  )}
                </div>
                <span className="line-clamp-3 text-[10px] leading-snug text-muted-foreground">
                  {a.systemPrompt}
                </span>
              </div>
            </div>

            <div className="mt-auto flex items-center gap-0.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copyPrompt(a);
                }}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Copy system prompt"
              >
                <HugeiconsIcon
                  icon={copiedId === a.id ? TickDouble01Icon : Copy01Icon}
                  size={12}
                  strokeWidth={1.75}
                />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  duplicate(a);
                }}
                className="inline-flex size-6 items-center justify-center rounded text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Duplicate"
              >
                ⧉
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(a);
                }}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Edit"
              >
                <HugeiconsIcon icon={PencilEdit02Icon} size={12} strokeWidth={1.75} />
              </button>
              {!BUILT_IN_IDS.has(a.id) && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(a.id);
                  }}
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                  title="Delete"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
                </button>
              )}
            </div>
          </div>
        ))}

        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={18} strokeWidth={1.75} />
            Add agent
          </button>
        )}
      </div>

      {showForm && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-muted/20 p-3">
          <div className="grid grid-cols-12 gap-2">
            <input
              type="text"
              value={form.icon}
              onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
              placeholder="Icon (emoji)"
              className="col-span-3 h-8 rounded border border-border/60 bg-background px-2 text-[12px] text-foreground outline-none focus:border-primary"
            />
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Agent name"
              className="col-span-9 h-8 rounded border border-border/60 bg-background px-2 text-[12px] text-foreground outline-none focus:border-primary"
            />
          </div>
          <textarea
            value={form.systemPrompt}
            onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
            placeholder="System prompt"
            rows={4}
            className="resize-none rounded border border-border/60 bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:border-primary"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!form.name.trim() || !form.systemPrompt.trim()}
              className="rounded bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
            >
              {editing ? "Update" : "Add"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
