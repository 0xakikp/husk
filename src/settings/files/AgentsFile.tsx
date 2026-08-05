import { useState } from "react";
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

export function AgentsFile() {
  const p = usePrefs();
  /* Per-workspace background prepended to every AI request, so the stack does not
     need re-explaining in each new session. Hand-written on purpose — a wrong
     auto-summary would be silently attached to everything. */
  const [memory, setMemory] = useState(() => getProjectMemory());
  const workspace = getWorkspaceRoot();
  const [editing, setEditing] = useState<AiAgent | null>(null);
  const [form, setForm] = useState({ name: "", icon: "", systemPrompt: "", model: "" });
  const [showForm, setShowForm] = useState(false);

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
    reset();
  };

  const reset = () => {
    setEditing(null);
    setForm({ name: "", icon: "", systemPrompt: "", model: "" });
    setShowForm(false);
  };

  const startEdit = (a: AiAgent) => {
    setEditing(a);
    setForm({ name: a.name, icon: a.icon, systemPrompt: a.systemPrompt, model: a.model ?? "" });
    setShowForm(true);
  };

  const duplicate = (a: AiAgent) => {
    void saveAgents([...agents, { ...a, id: nextId(), name: `${a.name} Copy`, builtIn: false }]);
  };

  const remove = (id: string) => {
    const next = agents.filter((a) => a.id !== id);
    void saveAgents(next);
    if (p.activeAgentId === id) {
      const fallback = next.find((a) => a.id === "code") || next[0];
      if (fallback) setPrefs({ activeAgentId: fallback.id });
    }
  };

  const resetBuiltIn = (id: string) => {
    const shipped = builtInAiAgents().find((agent) => agent.id === id);
    if (!shipped) return;
    void saveAgents(agents.map((agent) => (agent.id === id ? shipped : agent)));
  };

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.agents} />
      <CfgBlank />

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
      <CfgComment>These controls apply to API-backed models. Claude Code and Codex subscription modes remain read-only.</CfgComment>
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

      {agents.map((a) => (
        <div key={a.id}>
          <CfgSection name="agents" array />
          <CfgRow name="name" comment="Agent name, shown in the composer's agent picker.">
            <span className="mr-1">{a.icon}</span>
            <CfgStr>{a.name}</CfgStr>
            {a.id === p.activeAgentId ? (
              <span className="cfg-hint">active</span>
            ) : null}
            {a.builtIn ? <span className="cfg-hint">built-in</span> : null}
          </CfgRow>
          <CfgRow name="prompt" comment="System prompt that defines this agent's behaviour and tone.">
            <CfgStr>{a.systemPrompt.split("\n")[0].slice(0, 70)}{a.systemPrompt.length > 70 ? "…" : ""}</CfgStr>
          </CfgRow>
          {a.model ? (
            <CfgRow name="model" comment="This agent overrides the global model when that model is available from the selected provider.">
              <CfgStr>{a.model}</CfgStr>
            </CfgRow>
          ) : null}
          <CfgRow>
            <CfgAct onClick={() => startEdit(a)}>edit</CfgAct>
            <CfgAct onClick={() => duplicate(a)}>duplicate</CfgAct>
            {a.id !== p.activeAgentId ? (
              <CfgAct onClick={() => setPrefs({ activeAgentId: a.id })}>set active</CfgAct>
            ) : null}
            {!BUILT_IN_IDS.has(a.id) ? (
              <CfgAct onClick={() => remove(a.id)} danger>delete</CfgAct>
            ) : null}
            {a.builtIn && isBuiltInOverride(a) ? (
              <CfgAct onClick={() => resetBuiltIn(a.id)}>reset</CfgAct>
            ) : null}
          </CfgRow>
          <CfgBlank />
        </div>
      ))}

      {showForm ? (
        <>
          <CfgSection name="agents" array />
          <CfgComment>{editing ? "editing agent" : "new agent"}</CfgComment>
          <CfgRow name="icon" comment="Emoji shown beside the agent name.">
            <CfgText value={form.icon} onChange={(icon) => setForm((f) => ({ ...f, icon }))} placeholder="🤖" widthCh={4} />
          </CfgRow>
          <CfgRow name="name" comment="Agent name, shown in the composer's agent picker.">
            <CfgText value={form.name} onChange={(name) => setForm((f) => ({ ...f, name }))} placeholder="Agent name" widthCh={18} />
          </CfgRow>
          <CfgRow name="systemPrompt" comment="System prompt that defines this agent's behaviour and tone.">
            <CfgBlock
              value={form.systemPrompt}
              onChange={(systemPrompt) => setForm((f) => ({ ...f, systemPrompt }))}
              placeholder="You are the …"
              rows={4}
            />
          </CfgRow>
          <CfgRow name="model" comment="Optional override for this agent. Leave empty to use the global model in AI & Models; use a model ID available from the selected provider.">
            <CfgText
              value={form.model}
              onChange={(model) => setForm((f) => ({ ...f, model }))}
              placeholder="Use global default"
              widthCh={24}
            />
          </CfgRow>
          <CfgRow>
            <CfgAct onClick={save}>{editing ? "update" : "add"}</CfgAct>
            <CfgAct onClick={reset}>cancel</CfgAct>
          </CfgRow>
        </>
      ) : (
        <CfgRow>
          <CfgAct onClick={() => setShowForm(true)}>+ add agent</CfgAct>
        </CfgRow>
      )}

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
    </ConfigEditor>
  );
}
