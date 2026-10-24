import { useRef, useState, type ReactNode } from "react";
import { usePrefs, getPrefs, preferencesForNativeConfig, type PromptTemplate } from "../preferences";
import { commitNativeConfigSections } from "../nativeConfig";
import { confirmSettingsNavigation, useSettingsDraft } from "../settingsDrafts";
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const newTemplateId = useRef<string | null>(null);

  const templates = p.aiPromptTemplates ?? [];
  const formOpen = view.kind === "add" || !!editing;
  const original = editing ? { label: editing.label, icon: editing.icon, prompt: editing.prompt } : EMPTY_PROMPT_FORM;
  const dirty = formOpen && JSON.stringify(form) !== JSON.stringify(original);
  useSettingsDraft(dirty, "prompt template", busy);

  const commitTemplates = async (next: PromptTemplate[]) => {
    const previous = preferencesForNativeConfig(getPrefs());
    // Explicit forms write first. A failed draft must never remain queued for
    // automatic persistence after the user discards it or switches categories.
    await commitNativeConfigSections({ preferences: { ...previous, aiPromptTemplates: next } }, { preferences: previous });
  };

  const perform = async (operation: () => Promise<void>) => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(null);
    try { await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this template. Your draft is still here; try again."); }
    finally { saving.current = false; setBusy(false); }
  };

  const save = () => {
    if (saving.current) return;
    if (!form.label.trim()) { setError("Enter a label for this prompt template."); return; }
    if (!form.prompt.trim()) { setError("Enter prompt text before saving."); return; }
    if (form.label.includes("\0") || form.prompt.includes("\0") || form.icon.includes("\0")) { setError("Remove null characters from the label, prompt, or icon before saving."); return; }
    if (form.label.trim().length > 160 || form.icon.trim().length > 64 || form.prompt.trim().length > 32_000) { setError("Use at most 160 characters for the label, 64 for the icon, and 32,000 for the prompt."); return; }
    newTemplateId.current ??= nextId();
    const item: PromptTemplate = {
      id: editing?.id ?? newTemplateId.current,
      label: form.label.trim(),
      icon: form.icon.trim() || "✨",
      prompt: form.prompt.trim(),
    };
    void perform(async () => {
      const current = getPrefs().aiPromptTemplates;
      const next = current.some((template) => template.id === item.id)
        ? current.map((template) => template.id === item.id ? item : template)
        : [...current, item];
      if (next.length > 256) throw new Error("You can save up to 256 prompt templates. Remove one before adding another.");
      await commitTemplates(next);
      resetForm();
      setView({ kind: "template", id: item.id });
    });
  };

  const resetForm = () => {
    setEditing(null);
    setForm(EMPTY_PROMPT_FORM);
    newTemplateId.current = null;
    setError(null);
  };

  const cancelForm = async () => {
    if (saving.current || !await confirmSettingsNavigation()) return;
    const editingId = editing?.id;
    resetForm();
    setView(editingId ? { kind: "template", id: editingId } : { kind: "overview" });
  };

  const startEdit = (t: PromptTemplate) => {
    setError(null);
    setEditing(t);
    setForm({ label: t.label, icon: t.icon, prompt: t.prompt });
    setView({ kind: "template", id: t.id });
  };

  const startAdd = () => {
    resetForm();
    newTemplateId.current = nextId();
    setView({ kind: "add" });
  };

  const remove = (id: string) => {
    void perform(async () => {
      await commitTemplates(getPrefs().aiPromptTemplates.filter((template) => template.id !== id));
      resetForm();
      setView({ kind: "overview" });
    });
  };

  const move = (index: number, dir: -1 | 1) => {
    const arr = [...getPrefs().aiPromptTemplates];
    const selectedId = templates[index]?.id;
    index = arr.findIndex((template) => template.id === selectedId);
    const newIndex = index + dir;
    if (index < 0 || newIndex < 0 || newIndex >= arr.length) return;
    [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
    void perform(() => commitTemplates(arr));
  };

  const selectedTemplate = view.kind === "template"
    ? templates.find((template) => template.id === view.id) ?? (editing?.id === view.id ? editing : null)
    : null;

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.prompts} />
      <CfgBlank />
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="sr-only">Prompt templates</legend>
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
          <PromptInspectorHead title="New template" subtitle="Create a reusable composer slash command." onBack={() => void cancelForm()} />
          <PromptEditorForm
            editing={null}
            form={form}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            onSave={save}
            onCancel={() => void cancelForm()}
          />
        </section>
      ) : selectedTemplate ? (
        <section className="settings-entity-inspector" aria-label={`${selectedTemplate.label} prompt template`}>
          <PromptInspectorHead
            title={`${selectedTemplate.icon} /${selectedTemplate.label}`}
            subtitle={`Composer order · ${templates.findIndex((template) => template.id === selectedTemplate.id) + 1}`}
            onBack={() => {
              if (saving.current) return;
              void confirmSettingsNavigation().then((allow) => {
                if (!allow || saving.current) return;
                resetForm();
                setView({ kind: "overview" });
              });
            }}
            actions={editing ? undefined : <CfgAct onClick={() => startEdit(selectedTemplate)}>edit</CfgAct>}
          />
          {editing ? (
            <PromptEditorForm
              editing={editing}
              form={form}
              onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
              onSave={save}
              onCancel={() => void cancelForm()}
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
      </fieldset>
      {busy && <p role="status">Saving prompt templates…</p>}
      {error && <p role="alert">{error}</p>}
    </ConfigEditor>
  );
}
