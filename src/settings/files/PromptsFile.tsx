import { useState } from "react";
import { usePrefs, setPrefs, type PromptTemplate } from "../preferences";
import {
  ConfigEditor,
  CfgArt,
  CfgAct,
  CfgBlank,
  CfgBlock,
  CfgComment,
  CfgRow,
  CfgSection,
  CfgStr,
  CfgText,
} from "../config/controls";
import { BANNERS } from "../config/banners";

function nextId() {
  return `template-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

export function PromptsFile() {
  const p = usePrefs();
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [form, setForm] = useState({ label: "", icon: "", prompt: "" });
  const [showForm, setShowForm] = useState(false);

  const templates = p.aiPromptTemplates ?? [];

  const save = () => {
    if (!form.label.trim() || !form.prompt.trim()) return;
    const item: PromptTemplate = {
      id: editing?.id ?? nextId(),
      label: form.label.trim(),
      icon: form.icon.trim() || "✨",
      prompt: form.prompt.trim(),
    };
    const next = editing
      ? templates.map((t) => (t.id === editing.id ? item : t))
      : [...templates, item];
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
    setPrefs({ aiPromptTemplates: templates.filter((t) => t.id !== id) });
  };

  const move = (index: number, dir: -1 | 1) => {
    const arr = [...templates];
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= arr.length) return;
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    setPrefs({ aiPromptTemplates: arr });
  };

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.prompts} />
      <CfgBlank />
      <CfgComment>shown as /slash commands in the AI composer, in order</CfgComment>
      <CfgBlank />

      {templates.map((t, i) => (
        <div key={t.id}>
          <CfgSection name="prompts" array />
          <CfgRow name="label">
            <span className="mr-1">{t.icon}</span>
            <CfgStr>{t.label}</CfgStr>
          </CfgRow>
          <CfgRow name="prompt">
            <CfgStr>{t.prompt.split("\n")[0].slice(0, 70)}{t.prompt.length > 70 ? "…" : ""}</CfgStr>
          </CfgRow>
          <CfgRow>
            <CfgAct onClick={() => startEdit(t)}>edit</CfgAct>
            {i > 0 ? <CfgAct onClick={() => move(i, -1)}>↑ up</CfgAct> : null}
            {i < templates.length - 1 ? <CfgAct onClick={() => move(i, 1)}>↓ down</CfgAct> : null}
            <CfgAct onClick={() => remove(t.id)} danger>delete</CfgAct>
          </CfgRow>
          <CfgBlank />
        </div>
      ))}

      {showForm ? (
        <>
          <CfgSection name="prompts" array />
          <CfgComment>{editing ? "editing template" : "new template"}</CfgComment>
          <CfgRow name="icon">
            <CfgText value={form.icon} onChange={(icon) => setForm((f) => ({ ...f, icon }))} placeholder="✨" widthCh={4} />
          </CfgRow>
          <CfgRow name="label">
            <CfgText value={form.label} onChange={(label) => setForm((f) => ({ ...f, label }))} placeholder="Label" widthCh={16} />
          </CfgRow>
          <CfgRow name="prompt">
            <CfgBlock
              value={form.prompt}
              onChange={(prompt) => setForm((f) => ({ ...f, prompt }))}
              placeholder="Prompt text"
              rows={3}
            />
          </CfgRow>
          <CfgRow>
            <CfgAct onClick={save}>{editing ? "update" : "add"}</CfgAct>
            <CfgAct onClick={reset}>cancel</CfgAct>
          </CfgRow>
        </>
      ) : (
        <CfgRow>
          <CfgAct onClick={() => setShowForm(true)}>+ add template</CfgAct>
        </CfgRow>
      )}
    </ConfigEditor>
  );
}
