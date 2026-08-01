import { useState } from "react";
import { usePrefs, setPrefs, type AiAgent } from "../preferences";
import {
  ConfigEditor,
  CfgArt,
  CfgAct,
  CfgBlank,
  CfgBlock,
  CfgComment,
  CfgEnum,
  CfgRow,
  CfgSection,
  CfgStr,
  CfgText,
} from "../config/controls";
import { BANNERS } from "../config/banners";

function nextId() {
  return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
}

const BUILT_IN_IDS = new Set(["architect", "code", "ask", "debug", "orchestrator"]);

export function AgentsFile() {
  const p = usePrefs();
  const [editing, setEditing] = useState<AiAgent | null>(null);
  const [form, setForm] = useState({ name: "", icon: "", systemPrompt: "" });
  const [showForm, setShowForm] = useState(false);

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
    const next = editing
      ? agents.map((a) => (a.id === editing.id ? item : a))
      : [...agents, item];
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
    setPrefs({
      aiAgents: [...agents, { ...a, id: nextId(), name: `${a.name} Copy`, builtIn: false }],
    });
  };

  const remove = (id: string) => {
    const next = agents.filter((a) => a.id !== id);
    setPrefs({ aiAgents: next });
    if (p.activeAgentId === id) {
      const fallback = next.find((a) => a.id === "code") || next[0];
      if (fallback) setPrefs({ activeAgentId: fallback.id });
    }
  };

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.agents} />
      <CfgBlank />

      <CfgSection name="ai" />
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
          <CfgRow name="name">
            <span className="mr-1">{a.icon}</span>
            <CfgStr>{a.name}</CfgStr>
            {a.id === p.activeAgentId ? (
              <span className="cfg-hint">active</span>
            ) : null}
            {a.builtIn ? <span className="cfg-hint">built-in</span> : null}
          </CfgRow>
          <CfgRow name="prompt">
            <CfgStr>{a.systemPrompt.split("\n")[0].slice(0, 70)}{a.systemPrompt.length > 70 ? "…" : ""}</CfgStr>
          </CfgRow>
          <CfgRow>
            <CfgAct onClick={() => startEdit(a)}>edit</CfgAct>
            <CfgAct onClick={() => duplicate(a)}>duplicate</CfgAct>
            {a.id !== p.activeAgentId ? (
              <CfgAct onClick={() => setPrefs({ activeAgentId: a.id })}>set active</CfgAct>
            ) : null}
            {!BUILT_IN_IDS.has(a.id) ? (
              <CfgAct onClick={() => remove(a.id)} danger>delete</CfgAct>
            ) : null}
          </CfgRow>
          <CfgBlank />
        </div>
      ))}

      {showForm ? (
        <>
          <CfgSection name="agents" array />
          <CfgComment>{editing ? "editing agent" : "new agent"}</CfgComment>
          <CfgRow name="icon">
            <CfgText value={form.icon} onChange={(icon) => setForm((f) => ({ ...f, icon }))} placeholder="🤖" widthCh={4} />
          </CfgRow>
          <CfgRow name="name">
            <CfgText value={form.name} onChange={(name) => setForm((f) => ({ ...f, name }))} placeholder="Agent name" widthCh={18} />
          </CfgRow>
          <CfgRow name="systemPrompt">
            <CfgBlock
              value={form.systemPrompt}
              onChange={(systemPrompt) => setForm((f) => ({ ...f, systemPrompt }))}
              placeholder="You are the …"
              rows={4}
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
    </ConfigEditor>
  );
}
