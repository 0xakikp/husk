import { useState, type ReactNode } from "react";
import { builtInAiAgents, usePrefs, setPrefs, type AiAgent, type AiResponseStyle } from "../preferences";
import {
  ConfigEditor,
  CfgArt,
  CfgAct,
  CfgBlank,
  CfgBlock,
  CfgBool,
  CfgComment,
  CfgEnum,
  CfgRow,
  CfgSection,
  CfgStr,
  CfgText,
} from "../config/controls";
import { BANNERS } from "../config/banners";
import { getProjectMemory, setProjectMemory, MAX_MEMORY_CHARS } from "../../ai/projectMemory";
import { MAX_GLOBAL_INSTRUCTIONS_CHARS, MAX_PERSONAL_MEMORY_CHARS } from "../../ai/huskContext";
import { getWorkspaceRoot } from "../../workspace/store";
import { saveAiAgentsToFiles } from "../../ai/agentFiles";
import { toast } from "../../toast";

function nextId() {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

const BUILT_IN_IDS = new Set(["architect", "code", "ask", "debug", "orchestrator"]);

type AgentsView =
  | { kind: "overview" }
  | { kind: "agent"; id: string }
  | { kind: "add" };

type AgentFormState = { name: string; icon: string; systemPrompt: string; model: string };

const EMPTY_AGENT_FORM: AgentFormState = { name: "", icon: "", systemPrompt: "", model: "" };

function isBuiltInOverride(agent: AiAgent) {
  const shipped = builtInAiAgents().find((candidate) => candidate.id === agent.id);
  return Boolean(
    shipped && (
      agent.name !== shipped.name
      || agent.icon !== shipped.icon
      || agent.systemPrompt !== shipped.systemPrompt
      || (agent.model ?? "") !== (shipped.model ?? "")
      || (agent.color ?? "") !== (shipped.color ?? "")
    ),
  );
}

function AgentDirectory({
  agents,
  activeId,
  onOpen,
  onAdd,
}: {
  agents: AiAgent[];
  activeId: string;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <CfgSection name="agents" />
      <section className="settings-entity-directory" aria-label="AI agents">
        <div className="settings-entity-directory-head">
          <div>
            <p>Agent roster <span>{agents.length}</span></p>
            <small>Open an agent to edit its speciality, prompt, or model override.</small>
          </div>
          <CfgAct onClick={onAdd}>+ add agent</CfgAct>
        </div>
        <div className="settings-entity-grid">
          {agents.map((agent) => {
            const active = agent.id === activeId;
            const preview = agent.systemPrompt.split("\n").find(Boolean)?.trim() || "No instructions";
            return (
              <button
                key={agent.id}
                type="button"
                className={`settings-entity-card ${active ? "is-active" : ""}`}
                onClick={() => onOpen(agent.id)}
              >
                <span className="settings-entity-icon" aria-hidden="true">{agent.icon}</span>
                <span className="settings-entity-copy">
                  <strong>{agent.name}</strong>
                  <small>{preview}</small>
                  <em>{agent.model ? `model override · ${agent.model}` : "uses the default model"}</em>
                </span>
                <span className="settings-entity-tags">
                  {active ? <span className="is-primary">active</span> : null}
                  {agent.builtIn ? <span>built-in</span> : null}
                </span>
                <span className="settings-entity-chevron" aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

function AgentInspectorHead({
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
      <button type="button" onClick={onBack}>← all agents</button>
      <div className="settings-entity-inspector-title">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {actions ? <div className="settings-entity-inspector-actions">{actions}</div> : null}
    </header>
  );
}

function AgentEditorForm({
  editing,
  form,
  onChange,
  onSave,
  onCancel,
}: {
  editing: AiAgent | null;
  form: AgentFormState;
  onChange: (patch: Partial<AgentFormState>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="settings-entity-editor" aria-label={editing ? "Edit agent" : "Add agent"}>
      <CfgSection name={editing ? "editAgent" : "newAgent"} />
      <CfgRow name="icon" comment="Emoji shown beside the agent name.">
        <CfgText value={form.icon} onChange={(icon) => onChange({ icon })} placeholder="🤖" widthCh={4} />
      </CfgRow>
      <CfgRow name="name" comment="Agent name, shown in the composer's agent picker.">
        <CfgText value={form.name} onChange={(name) => onChange({ name })} placeholder="Agent name" widthCh={18} />
      </CfgRow>
      <CfgRow name="systemPrompt" comment="System prompt that defines this agent's behaviour and tone.">
        <CfgBlock
          value={form.systemPrompt}
          onChange={(systemPrompt) => onChange({ systemPrompt })}
          placeholder="You are the …"
          rows={5}
        />
      </CfgRow>
      <CfgRow name="model" comment="Optional override. Leave empty to use the global model in AI & Models.">
        <CfgText
          value={form.model}
          onChange={(model) => onChange({ model })}
          placeholder="Use global default"
          widthCh={24}
        />
      </CfgRow>
      <CfgRow>
        <CfgAct onClick={onSave}>{editing ? "save changes" : "add agent"}</CfgAct>
        <CfgAct onClick={onCancel}>cancel</CfgAct>
      </CfgRow>
    </section>
  );
}

export function AgentsFile() {
  const p = usePrefs();
  /* Per-workspace background prepended to every AI request, so the stack does not
     need re-explaining in each new session. Hand-written on purpose — a wrong
     auto-summary would be silently attached to everything. */
  const [memory, setMemory] = useState(() => getProjectMemory());
  const workspace = getWorkspaceRoot();
  const [view, setView] = useState<AgentsView>({ kind: "overview" });
  const [editing, setEditing] = useState<AiAgent | null>(null);
  const [form, setForm] = useState<AgentFormState>(EMPTY_AGENT_FORM);

  const agents = p.aiAgents ?? [];

  const saveAgents = async (next: AiAgent[]) => {
    // Keep the picker responsive immediately; the native Markdown write is
    // then reconciled in the background and reports a real failure instead of
    // silently pretending the setting survived a restart.
    setPrefs({ aiAgents: next });
    try {
      await saveAiAgentsToFiles(next);
    } catch (cause) {
      toast({
        title: "Could not save AI agents",
        message: cause instanceof Error ? cause.message : String(cause),
        variant: "error",
      });
    }
  };

  const save = () => {
    if (!form.name.trim() || !form.systemPrompt.trim()) return;
    const item: AiAgent = {
      id: editing?.id ?? nextId(),
      name: form.name.trim(),
      icon: form.icon.trim() || "🤖",
      systemPrompt: form.systemPrompt.trim(),
      model: form.model.trim() || undefined,
      color: editing?.color,
      builtIn: editing?.builtIn ?? false,
    };
    const next = editing
      ? agents.map((a) => (a.id === editing.id ? item : a))
      : [...agents, item];
    void saveAgents(next);
    setEditing(null);
    setForm(EMPTY_AGENT_FORM);
    setView({ kind: "agent", id: item.id });
  };

  const resetForm = () => {
    setEditing(null);
    setForm(EMPTY_AGENT_FORM);
  };

  const cancelForm = () => {
    const editingId = editing?.id;
    resetForm();
    setView(editingId ? { kind: "agent", id: editingId } : { kind: "overview" });
  };

  const startEdit = (a: AiAgent) => {
    setEditing(a);
    setForm({ name: a.name, icon: a.icon, systemPrompt: a.systemPrompt, model: a.model ?? "" });
    setView({ kind: "agent", id: a.id });
  };

  const startAdd = () => {
    resetForm();
    setView({ kind: "add" });
  };

  const duplicate = (a: AiAgent) => {
    const copy = { ...a, id: nextId(), name: `${a.name} Copy`, builtIn: false };
    void saveAgents([...agents, copy]);
    setView({ kind: "agent", id: copy.id });
  };

  const remove = (id: string) => {
    const next = agents.filter((a) => a.id !== id);
    void saveAgents(next);
    if (p.activeAgentId === id) {
      const fallback = next.find((a) => a.id === "code") || next[0];
      if (fallback) setPrefs({ activeAgentId: fallback.id });
    }
    resetForm();
    setView({ kind: "overview" });
  };

  const resetBuiltIn = (id: string) => {
    const shipped = builtInAiAgents().find((agent) => agent.id === id);
    if (!shipped) return;
    void saveAgents(agents.map((agent) => (agent.id === id ? shipped : agent)));
  };

  const selectedAgent = view.kind === "agent"
    ? agents.find((agent) => agent.id === view.id) ?? null
    : null;

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.agents} />
      <CfgBlank />

      {view.kind === "overview" ? (
        <>
      <CfgSection name="ai" />
      <CfgComment>Every agent inherits Husk product knowledge and current model access. Its own prompt adds its speciality and tone.</CfgComment>
      <CfgComment>Custom agents and edited built-ins are saved as Markdown files in ~/.husk/agents/ and survive reinstalling Husk.</CfgComment>
      <CfgBlank />

      <CfgSection name="defaults" />
      <CfgRow name="responseStyle" comment="Default level of detail for normal replies. A direct request from you always wins.">
        <CfgEnum<AiResponseStyle>
          value={p.aiResponseStyle}
          options={[
            { value: "concise", label: "Concise" },
            { value: "balanced", label: "Balanced" },
            { value: "detailed", label: "Detailed" },
          ]}
          onChange={(aiResponseStyle) => setPrefs({ aiResponseStyle })}
        />
      </CfgRow>
      <CfgRow name="globalInstructions" comment="Applied to every Husk AI chat. For example: preferred language, stack, or how you want answers structured.">
        <CfgBlock
          value={p.aiGlobalInstructions}
          onChange={(aiGlobalInstructions) => setPrefs({ aiGlobalInstructions: aiGlobalInstructions.slice(0, MAX_GLOBAL_INSTRUCTIONS_CHARS) })}
          placeholder="e.g. Prefer TypeScript. Explain commands before suggesting them."
          rows={4}
        />
      </CfgRow>
      <CfgRow name="personalMemory" comment="Optional background about you. Stored locally and shared with AI chats as context, not as an instruction.">
        <CfgBlock
          value={p.aiPersonalMemory}
          onChange={(aiPersonalMemory) => setPrefs({ aiPersonalMemory: aiPersonalMemory.slice(0, MAX_PERSONAL_MEMORY_CHARS) })}
          placeholder="e.g. I am learning Kubernetes and prefer beginner-friendly explanations."
          rows={3}
        />
      </CfgRow>
      <CfgBlank />

      <CfgSection name="newChatContext" />
      <CfgComment>These are defaults for a new AI chat. You can remove any context chip in an individual conversation.</CfgComment>
      <CfgRow name="contextBudget" comment="How much terminal, file, and project context Husk may attach to a new AI request. Treated as bytes, not tokens — roughly 8,000 English tokens per 32 KB. Attachments beyond the limit are never cut silently; Husk asks first.">
        <CfgEnum<number>
          value={p.aiContextBudgetKb ?? 32}
          options={[
            { value: 8, label: "8 KB" },
            { value: 16, label: "16 KB" },
            { value: 32, label: "32 KB" },
            { value: 64, label: "64 KB" },
          ]}
          onChange={(aiContextBudgetKb) => setPrefs({ aiContextBudgetKb })}
        />
      </CfgRow>
      <CfgRow name="includeTerminal" comment="Attach the current terminal output by default. Review the chip before sending if output may contain secrets.">
        <CfgBool value={p.aiDefaultIncludeTerminal} onChange={(aiDefaultIncludeTerminal) => setPrefs({ aiDefaultIncludeTerminal })} />
      </CfgRow>
      <CfgRow name="includeCurrentFile" comment="Attach the current editor file by default when one is open.">
        <CfgBool value={p.aiDefaultIncludeFile} onChange={(aiDefaultIncludeFile) => setPrefs({ aiDefaultIncludeFile })} />
      </CfgRow>
      <CfgRow name="includeSelection" comment="Attach the current editor selection by default when one is active.">
        <CfgBool value={p.aiDefaultIncludeSelection} onChange={(aiDefaultIncludeSelection) => setPrefs({ aiDefaultIncludeSelection })} />
      </CfgRow>
      <CfgBlank />

      <CfgSection name="toolAccess" />
      <CfgComment>These controls apply to API-backed models. Subscription / CLI modes remain read-only.</CfgComment>
      <CfgRow name="workspaceFileTools" comment="Allow the model to inspect workspace files and propose edits. Existing-file changes still go through review.">
        <CfgBool value={p.aiFileToolsEnabled} onChange={(aiFileToolsEnabled) => setPrefs({ aiFileToolsEnabled })} />
      </CfgRow>
      <CfgRow name="connectedMcpTools" comment="Allow configured MCP integrations, such as GitHub. Disabling this stops Husk from connecting them for AI chats.">
        <CfgBool value={p.aiMcpToolsEnabled} onChange={(aiMcpToolsEnabled) => setPrefs({ aiMcpToolsEnabled })} />
      </CfgRow>
      <CfgBlank />

      <CfgRow name="activeAgent" comment="Persona used by the AI composer.">
        <CfgEnum
          value={p.activeAgentId}
          options={agents.map((a) => ({ value: a.id, label: `${a.icon} ${a.name}` }))}
          onChange={(activeAgentId) => setPrefs({ activeAgentId })}
        />
      </CfgRow>
      <CfgBlank />

      <AgentDirectory
        agents={agents}
        activeId={p.activeAgentId}
        onOpen={(id) => {
          resetForm();
          setView({ kind: "agent", id });
        }}
        onAdd={startAdd}
      />

      <CfgBlank />
      <CfgSection name="project_memory" />
      <CfgRow
        name="notes"
        comment={
          workspace
            ? `Background sent with every AI request in ${workspace.split("/").pop()}. What the project is, its stack, its conventions.`
            : "Open a folder to give it project notes."
        }
      >
        <CfgBlock
          value={memory}
          onChange={(v) => {
            const capped = v.slice(0, MAX_MEMORY_CHARS);
            setMemory(capped);
            setProjectMemory(capped);
          }}
          placeholder={workspace ? "e.g. Tauri + React 19 desktop app. Prefer pnpm. Rust backend in src-tauri." : ""}
          rows={4}
          readOnly={!workspace}
        />
      </CfgRow>
        </>
      ) : view.kind === "add" ? (
        <section className="settings-entity-inspector" aria-label="New agent">
          <AgentInspectorHead title="New agent" subtitle="Create a specialist for the AI composer." onBack={cancelForm} />
          <AgentEditorForm
            editing={null}
            form={form}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            onSave={save}
            onCancel={cancelForm}
          />
        </section>
      ) : selectedAgent ? (
        <section className="settings-entity-inspector" aria-label={`${selectedAgent.name} agent settings`}>
          <AgentInspectorHead
            title={`${selectedAgent.icon} ${selectedAgent.name}`}
            subtitle={selectedAgent.model ? `Model override · ${selectedAgent.model}` : "Uses the global default model"}
            onBack={() => {
              resetForm();
              setView({ kind: "overview" });
            }}
            actions={
              editing ? undefined : (
                <>
                  <CfgAct onClick={() => startEdit(selectedAgent)}>edit</CfgAct>
                  <CfgAct onClick={() => duplicate(selectedAgent)}>duplicate</CfgAct>
                </>
              )
            }
          />
          {editing ? (
            <AgentEditorForm
              editing={editing}
              form={form}
              onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
              onSave={save}
              onCancel={cancelForm}
            />
          ) : (
            <>
              <CfgSection name="agent" />
              <CfgRow name="name" comment="Name shown in the composer's agent picker.">
                <CfgStr>{selectedAgent.name}</CfgStr>
              </CfgRow>
              <CfgRow name="systemPrompt" comment="Instructions that define this agent's speciality and tone.">
                <CfgBlock value={selectedAgent.systemPrompt} readOnly rows={Math.min(8, Math.max(3, selectedAgent.systemPrompt.split("\n").length))} />
              </CfgRow>
              <CfgRow name="model" comment="Leave empty to use the global model in AI & Models.">
                <CfgStr>{selectedAgent.model || "global default"}</CfgStr>
              </CfgRow>
              <CfgRow name="status" comment="Built-in agents can be customised and restored to their shipped prompt at any time.">
                <CfgStr>{selectedAgent.id === p.activeAgentId ? "active" : "available"}{selectedAgent.builtIn ? " · built-in" : " · custom"}</CfgStr>
              </CfgRow>
              <CfgRow>
                {selectedAgent.id !== p.activeAgentId ? <CfgAct onClick={() => setPrefs({ activeAgentId: selectedAgent.id })}>set active</CfgAct> : null}
                {selectedAgent.builtIn && isBuiltInOverride(selectedAgent) ? <CfgAct onClick={() => resetBuiltIn(selectedAgent.id)}>reset</CfgAct> : null}
                {!BUILT_IN_IDS.has(selectedAgent.id) ? <CfgAct onClick={() => remove(selectedAgent.id)} danger>delete</CfgAct> : null}
              </CfgRow>
            </>
          )}
        </section>
      ) : (
        <CfgRow><CfgAct onClick={() => setView({ kind: "overview" })}>back to agents</CfgAct></CfgRow>
      )}
    </ConfigEditor>
  );
}
