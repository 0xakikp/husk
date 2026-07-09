import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  ArrowUp01Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons";
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

  const templates = p.aiPromptTemplates ?? [];

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="AI Prompt Templates" description="Quick-action prompts shown in the AI composer. Add, edit, or remove them here." />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {templates.map((t, i) => (
          <div
            key={t.id}
            className="group relative flex flex-col gap-1 rounded-lg border border-border/40 bg-muted/20 p-3 transition-colors hover:border-border/70 hover:bg-muted/30"
          >
              <div className="flex items-start gap-2">
                <span className="text-[18px] leading-none">{t.icon}</span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-foreground">
                    {t.label}
                  </span>
                  <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                    {t.prompt}
                  </span>
                </div>
              </div>

              <div className="mt-1 flex items-center gap-0.5">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                  title="Move up"
                >
                  <HugeiconsIcon icon={ArrowUp01Icon} size={12} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  disabled={i === templates.length - 1}
                  onClick={() => move(i, 1)}
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                  title="Move down"
                >
                  <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(t)}
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Edit"
                >
                  <HugeiconsIcon icon={PencilEdit02Icon} size={12} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
                  title="Delete"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
                </button>
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
            Add template
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
  );
}
