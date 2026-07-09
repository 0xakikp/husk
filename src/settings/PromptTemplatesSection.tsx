import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, PencilEdit02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { usePrefs, setPrefs, type PromptTemplate } from "./preferences";
import { SectionHeader } from "./components/SectionHeader";

function nextId() {
  return `template-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

export function PromptTemplatesSection() {
  const p = usePrefs();
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [form, setForm] = useState({ label: "", icon: "", prompt: "" });
  const [showForm, setShowForm] = useState(false);

  const save = () => {
    if (!form.label.trim() || !form.prompt.trim()) return;
    const item: PromptTemplate = {
      id: editing?.id ?? nextId(),
      label: form.label.trim(),
      icon: form.icon.trim() || "✨",
      prompt: form.prompt.trim(),
    };
    const existing = p.aiPromptTemplates ?? [];
    const next = editing
      ? existing.map((t) => (t.id === editing.id ? item : t))
      : [...existing, item];
    setPrefs({ aiPromptTemplates: next });
    reset();
  };

  const reset = () => {
    setEditing(null);
    setForm({ label: "", icon: "", prompt: "" });
    setShowForm(false);
  };

  const startEdit = (t: PromptTemplate) => {
    setEditing(t);
    setForm({ label: t.label, icon: t.icon, prompt: t.prompt });
    setShowForm(true);
  };

  const remove = (id: string) => {
    const next = (p.aiPromptTemplates ?? []).filter((t) => t.id !== id);
    setPrefs({ aiPromptTemplates: next });
  };

  const move = (index: number, dir: -1 | 1) => {
    const arr = [...(p.aiPromptTemplates ?? [])];
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= arr.length) return;
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    setPrefs({ aiPromptTemplates: arr });
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="AI Prompt Templates" description="Quick-action prompts shown in the AI composer. Add, edit, or remove them here." />

      <div className="flex flex-col gap-2">
        {(p.aiPromptTemplates ?? []).map((t, i) => (
          <div
            key={t.id}
            className="group flex items-center justify-between gap-2 rounded border border-border/40 bg-muted/20 px-3 py-2"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-[12px] font-medium text-foreground">
                <span className="text-[13px]">{t.icon}</span>
                <span className="truncate">{t.label}</span>
              </span>
              <span className="truncate text-[11px] text-muted-foreground">{t.prompt}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                className="inline-flex size-6 items-center justify-center rounded text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={i === (p.aiPromptTemplates?.length ?? 0) - 1}
                onClick={() => move(i, 1)}
                className="inline-flex size-6 items-center justify-center rounded text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                title="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => startEdit(t)}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Edit"
              >
                <HugeiconsIcon icon={PencilEdit02Icon} size={11} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                title="Delete"
              >
                <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        ))}

        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded border border-dashed border-border/60 bg-muted/20 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={1.75} />
            Add template
          </button>
        )}

        {showForm && (
          <div className="flex flex-col gap-2 rounded border border-border/40 bg-muted/20 p-3">
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
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Label"
                className="col-span-9 h-8 rounded border border-border/60 bg-background px-2 text-[12px] text-foreground outline-none focus:border-primary"
              />
            </div>
            <textarea
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              placeholder="Prompt text"
              rows={3}
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
                disabled={!form.label.trim() || !form.prompt.trim()}
                className="rounded bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
              >
                {editing ? "Update" : "Add"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
