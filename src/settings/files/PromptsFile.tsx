import { useState, type ReactNode } from "react";
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

type PromptsView =
  | { kind: "overview" }
  | { kind: "template"; id: string }
  | { kind: "add" };

type PromptFormState = { label: string; icon: string; prompt: string };

const EMPTY_PROMPT_FORM: PromptFormState = { label: "", icon: "", prompt: "" };

function PromptDirectory({
  templates,
  onOpen,
  onAdd,
}: {
  templates: PromptTemplate[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <CfgSection name="templates" />
      <section className="settings-entity-directory" aria-label="Prompt templates">
        <div className="settings-entity-directory-head">
          <div>
            <p>Slash commands <span>{templates.length}</span></p>
            <small>Open a template to edit its prompt or change its composer order.</small>
          </div>
          <CfgAct onClick={onAdd}>+ add template</CfgAct>
        </div>
        <div className="settings-entity-grid">
          {templates.map((template, index) => {
            const preview = template.prompt.split("\n").find(Boolean)?.trim() || "No prompt text";
            return (
              <button
                key={template.id}
                type="button"
                className="settings-entity-card"
                onClick={() => onOpen(template.id)}
              >
                <span className="settings-entity-icon" aria-hidden="true">{template.icon}</span>
                <span className="settings-entity-copy">
                  <strong>/{template.label}</strong>
                  <small>{preview}</small>
                  <em>Composer order · {index + 1}</em>
                </span>
                <span className="settings-entity-tags"><span>template</span></span>
                <span className="settings-entity-chevron" aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
        {templates.length === 0 ? <p className="settings-entity-empty">No prompt templates yet. Add one to create a reusable /slash command.</p> : null}
      </section>
    </>
  );
}

function PromptInspectorHead({
  title,
  subtitle,
  onBack,
  actions,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="settings-entity-inspector-head">
      <button type="button" onClick={onBack}>← all templates</button>
      <div className="settings-entity-inspector-title">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {actions ? <div className="settings-entity-inspector-actions">{actions}</div> : null}
    </header>
  );
}

function PromptEditorForm({
  editing,
  form,
  onChange,
  onSave,
  onCancel,
}: {
  editing: PromptTemplate | null;
  form: PromptFormState;
  onChange: (patch: Partial<PromptFormState>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="settings-entity-editor" aria-label={editing ? "Edit prompt template" : "Add prompt template"}>
      <CfgSection name={editing ? "editTemplate" : "newTemplate"} />
      <CfgRow name="icon" comment="Emoji shown beside the slash command.">
        <CfgText value={form.icon} onChange={(icon) => onChange({ icon })} placeholder="✨" widthCh={4} />
      </CfgRow>
      <CfgRow name="label" comment="Name shown in the composer slash-command list.">
        <CfgText value={form.label} onChange={(label) => onChange({ label })} placeholder="Label" widthCh={16} />
      </CfgRow>
      <CfgRow name="prompt" comment="Text inserted when the command runs. Supports the current file and selection as context.">
        <CfgBlock value={form.prompt} onChange={(prompt) => onChange({ prompt })} placeholder="Prompt text" rows={5} />
      </CfgRow>
      <CfgRow>
        <CfgAct onClick={onSave}>{editing ? "save changes" : "add template"}</CfgAct>
        <CfgAct onClick={onCancel}>cancel</CfgAct>
      </CfgRow>
    </section>
  );
}

export function PromptsFile() {
  const p = usePrefs();
  const [view, setView] = useState<PromptsView>({ kind: "overview" });
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [form, setForm] = useState<PromptFormState>(EMPTY_PROMPT_FORM);

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
    setEditing(null);
    setForm(EMPTY_PROMPT_FORM);
    setView({ kind: "template", id: item.id });
  };

  const resetForm = () => {
    setEditing(null);
    setForm(EMPTY_PROMPT_FORM);
  };

  const cancelForm = () => {
    const editingId = editing?.id;
    resetForm();
    setView(editingId ? { kind: "template", id: editingId } : { kind: "overview" });
  };

  const startEdit = (t: PromptTemplate) => {
    setEditing(t);
    setForm({ label: t.label, icon: t.icon, prompt: t.prompt });
    setView({ kind: "template", id: t.id });
  };

  const startAdd = () => {
    resetForm();
    setView({ kind: "add" });
  };

  const remove = (id: string) => {
    setPrefs({ aiPromptTemplates: templates.filter((t) => t.id !== id) });
    resetForm();
    setView({ kind: "overview" });
  };

  const move = (index: number, dir: -1 | 1) => {
    const arr = [...templates];
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= arr.length) return;
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    setPrefs({ aiPromptTemplates: arr });
  };

  const selectedTemplate = view.kind === "template"
    ? templates.find((template) => template.id === view.id) ?? null
    : null;

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.prompts} />
      <CfgBlank />
      {view.kind === "overview" ? (
        <>
          <CfgComment>Shown as /slash commands in the AI composer, in order.</CfgComment>
          <CfgBlank />
          <PromptDirectory
            templates={templates}
            onOpen={(id) => {
              resetForm();
              setView({ kind: "template", id });
            }}
            onAdd={startAdd}
          />
        </>
      ) : view.kind === "add" ? (
        <section className="settings-entity-inspector" aria-label="New prompt template">
          <PromptInspectorHead title="New template" subtitle="Create a reusable composer slash command." onBack={cancelForm} />
          <PromptEditorForm
            editing={null}
            form={form}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            onSave={save}
            onCancel={cancelForm}
          />
        </section>
      ) : selectedTemplate ? (
        <section className="settings-entity-inspector" aria-label={`${selectedTemplate.label} prompt template`}>
          <PromptInspectorHead
            title={`${selectedTemplate.icon} /${selectedTemplate.label}`}
            subtitle={`Composer order · ${templates.findIndex((template) => template.id === selectedTemplate.id) + 1}`}
            onBack={() => {
              resetForm();
              setView({ kind: "overview" });
            }}
            actions={editing ? undefined : <CfgAct onClick={() => startEdit(selectedTemplate)}>edit</CfgAct>}
          />
          {editing ? (
            <PromptEditorForm
              editing={editing}
              form={form}
              onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
              onSave={save}
              onCancel={cancelForm}
            />
          ) : (
            <>
              <CfgSection name="template" />
              <CfgRow name="label" comment="Name shown in the composer slash-command list.">
                <CfgStr>/{selectedTemplate.label}</CfgStr>
              </CfgRow>
              <CfgRow name="prompt" comment="Text inserted when the command runs. Supports the current file and selection as context.">
                <CfgBlock value={selectedTemplate.prompt} readOnly rows={Math.min(8, Math.max(3, selectedTemplate.prompt.split("\n").length))} />
              </CfgRow>
              <CfgRow name="order" comment="Changes the position of this command in the composer.">
                <CfgStr>{templates.findIndex((template) => template.id === selectedTemplate.id) + 1}</CfgStr>
              </CfgRow>
              <CfgRow>
                {templates.findIndex((template) => template.id === selectedTemplate.id) > 0 ? <CfgAct onClick={() => move(templates.findIndex((template) => template.id === selectedTemplate.id), -1)}>↑ move up</CfgAct> : null}
                {templates.findIndex((template) => template.id === selectedTemplate.id) < templates.length - 1 ? <CfgAct onClick={() => move(templates.findIndex((template) => template.id === selectedTemplate.id), 1)}>↓ move down</CfgAct> : null}
                <CfgAct onClick={() => remove(selectedTemplate.id)} danger>delete</CfgAct>
              </CfgRow>
            </>
          )}
        </section>
      ) : (
        <CfgRow><CfgAct onClick={() => setView({ kind: "overview" })}>back to templates</CfgAct></CfgRow>
      )}
    </ConfigEditor>
  );
}
