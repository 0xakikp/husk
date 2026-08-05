import { useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";

import {
  ConfigEditor,
  CfgAct,
  CfgBlank,
  CfgBlock,
  CfgBool,
  CfgComment,
  CfgRow,
  CfgSection,
  CfgStr,
  CfgText,
} from "../config/controls";
import { getWorkspaceRoot } from "../../workspace/store";
import {
  GITIGNORE_SUGGESTION,
  deleteRunbook,
  initializeProjectProfile,
  saveProjectInstructions,
  saveRunbook,
  setProjectProfileEnabled,
  useProjectProfile,
  type Runbook,
} from "../../project/profile";
import { toast } from "../../toast";

/**
 * Project profile panel — per-repository instructions, runbooks, and
 * environments from `<workspaceRoot>/.husk/`. Separate from personal settings
 * by design: everything here lives in the repo, nothing follows the user.
 */
export function ProjectFile() {
  const workspace = getWorkspaceRoot();
  const profile = useProjectProfile();
  const [instructions, setInstructions] = useState("");
  const [editing, setEditing] = useState<Runbook | null>(null);
  const [showForm, setShowForm] = useState(false);

  /* Local edit buffer for instructions — writing to disk on every keystroke
     would mean a Rust round-trip per character. Save on blur or explicitly. */
  useEffect(() => {
    setInstructions(profile?.instructions ?? "");
  }, [profile?.instructions, profile?.husk_dir]);

  if (!workspace) {
    return (
      <ConfigEditor>
        <CfgSection name="project" />
        <CfgComment>Open a folder to give it a project profile.</CfgComment>
      </ConfigEditor>
    );
  }

  const fail = (title: string) => (cause: unknown) =>
    toast({ title, message: cause instanceof Error ? cause.message : String(cause), variant: "error" });

  const saveInstructions = () => {
    void saveProjectInstructions(instructions)
      .then(() => toast({ title: "Instructions saved", message: ".husk/instructions.md", variant: "success" }))
      .catch(fail("Could not save instructions"));
  };

  const startEdit = (rb: Runbook) => {
    setEditing({ ...rb, tags: rb.tags ?? [] });
    setShowForm(true);
  };

  const saveForm = () => {
    if (!editing?.id?.trim() || !editing.command?.trim()) return;
    void saveRunbook({
      ...editing,
      id: editing.id.trim(),
      title: editing.title?.trim() || editing.id.trim(),
      command: editing.command.trim(),
      tags: (editing.tags ?? []).filter(Boolean),
    })
      .then(() => {
        setShowForm(false);
        setEditing(null);
      })
      .catch(fail("Could not save runbook"));
  };

  return (
    <ConfigEditor>
      <CfgSection name="project" />
      <CfgComment>
        A project profile lives in this repository at .husk/ — instructions for the AI, repeatable command
        runbooks, and environment labels. It belongs to the repo, not to you; personal settings stay in Husk.
      </CfgComment>
      <CfgBlank />

      {!profile?.exists ? (
        <>
          <CfgRow name="status" comment="No .husk directory in this workspace yet.">
            <CfgStr>not initialized</CfgStr>
          </CfgRow>
          <CfgRow name="initialize" comment="Create .husk/ with project.toml, instructions.md, and a runbooks folder. Nothing is committed or changed in Git.">
            <CfgAct onClick={() => void initializeProjectProfile().catch(fail("Could not initialize profile"))}>
              Initialize project profile
            </CfgAct>
          </CfgRow>
        </>
      ) : (
        <>
          <CfgRow name="name" comment="Project name from project.toml.">
            <CfgStr>{profile.name || workspace.split("/").pop() || "project"}</CfgStr>
            {profile.enabled ? <span className="cfg-hint">active</span> : <span className="cfg-hint">disabled</span>}
          </CfgRow>
          <CfgRow name="location" comment="Profile directory. Everything Husk knows about this project lives here.">
            <CfgStr>{profile.husk_dir}</CfgStr>
            <CfgAct onClick={() => void openPath(profile.husk_dir).catch(fail("Could not open folder"))}>
              open .husk folder
            </CfgAct>
          </CfgRow>
          <CfgRow name="enabled" comment="When disabled, Husk ignores this profile: no instructions, no runbooks, no safety rules. The files stay in the repo.">
            <CfgBool
              value={profile.enabled}
              onChange={(v) => void setProjectProfileEnabled(v).catch(fail("Could not update profile"))}
            />
          </CfgRow>
          <CfgBlank />

          <CfgSection name="instructions" />
          <CfgRow
            name="instructions.md"
            comment={
              profile.include_instructions
                ? "Attached to every AI request in this workspace. Stack, conventions, preferred commands. Never secrets."
                : "Saved but NOT attached to AI — include_instructions is off in project.toml."
            }
          >
            <CfgBlock
              value={instructions}
              onChange={setInstructions}
              placeholder="- Package manager: pnpm&#10;- Run pnpm exec tsc --noEmit before UI changes"
              rows={6}
            />
          </CfgRow>
          <CfgRow>
            <CfgAct onClick={saveInstructions}>save instructions</CfgAct>
          </CfgRow>
          <CfgBlank />

          <CfgSection name="runbooks" array />
          <CfgComment>Repeatable commands. Run them from ⌘K (“Run: …”) — the exact command is always shown.</CfgComment>
          {profile.runbooks.length === 0 && (
            <CfgRow name="empty" comment="No runbooks yet. Add one below, or write .husk/runbooks/<id>.toml by hand.">
              <CfgStr>—</CfgStr>
            </CfgRow>
          )}
          {profile.runbooks.map((rb) => (
            <div key={rb.id}>
              <CfgRow name={rb.id ?? "runbook"} comment={rb.description || rb.command || ""}>
                <CfgStr>{rb.title || rb.id}</CfgStr>
                {rb.confirm ? <span className="cfg-hint">confirm</span> : null}
                {profile.default_runbook === rb.id ? <span className="cfg-hint">default</span> : null}
              </CfgRow>
              <CfgRow>
                <CfgAct onClick={() => startEdit(rb)}>edit</CfgAct>
                <CfgAct onClick={() => void deleteRunbook(rb.id ?? "").catch(fail("Could not delete runbook"))} danger>
                  delete
                </CfgAct>
              </CfgRow>
            </div>
          ))}
          {showForm && editing ? (
            <>
              <CfgSection name="runbooks" array />
              <CfgRow name="id" comment="Filename-safe identifier (becomes runbooks/<id>.toml).">
                <CfgText value={editing.id ?? ""} onChange={(id) => setEditing((r) => (r ? { ...r, id } : r))} placeholder="typecheck" widthCh={18} />
              </CfgRow>
              <CfgRow name="title" comment="Shown in ⌘K as “Run: <title>”.">
                <CfgText value={editing.title ?? ""} onChange={(title) => setEditing((r) => (r ? { ...r, title } : r))} placeholder="Type check" widthCh={24} />
              </CfgRow>
              <CfgRow name="command" comment="Exact command. Reference environment variable NAMES only — never secret values.">
                <CfgText value={editing.command ?? ""} onChange={(command) => setEditing((r) => (r ? { ...r, command } : r))} placeholder="pnpm exec tsc --noEmit" widthCh={36} />
              </CfgRow>
              <CfgRow name="cwd" comment="Working directory relative to the workspace root. Leave empty for the root.">
                <CfgText value={editing.cwd ?? ""} onChange={(cwd) => setEditing((r) => (r ? { ...r, cwd } : r))} placeholder="." widthCh={12} />
              </CfgRow>
              <CfgRow name="confirm" comment="Risky action: the command is typed at the prompt for review instead of running immediately.">
                <CfgBool value={editing.confirm ?? false} onChange={(confirm) => setEditing((r) => (r ? { ...r, confirm } : r))} />
              </CfgRow>
              <CfgRow name="tags" comment="Comma-separated search tags for ⌘K.">
                <CfgText
                  value={(editing.tags ?? []).join(", ")}
                  onChange={(v) => setEditing((r) => (r ? { ...r, tags: v.split(",").map((t) => t.trim()) } : r))}
                  placeholder="quality, typescript"
                  widthCh={24}
                />
              </CfgRow>
              <CfgRow>
                <CfgAct onClick={saveForm}>save runbook</CfgAct>
                <CfgAct onClick={() => { setShowForm(false); setEditing(null); }}>cancel</CfgAct>
              </CfgRow>
            </>
          ) : (
            <CfgRow>
              <CfgAct onClick={() => { setEditing({ id: "", title: "", command: "", cwd: "", confirm: false, tags: [] }); setShowForm(true); }}>
                + add runbook
              </CfgAct>
            </CfgRow>
          )}
          <CfgBlank />

          {profile.environments_raw.trim() && (
            <>
              <CfgSection name="environments" />
              <CfgRow name="environments.toml" comment="Environment labels for this project. Editing lands with the safety-signal work; shown here so the file is discoverable.">
                <CfgBlock value={profile.environments_raw} onChange={() => {}} rows={4} readOnly />
              </CfgRow>
              <CfgBlank />
            </>
          )}

          <CfgSection name="gitignore" />
          <CfgRow name="suggestion" comment="Machine-local overrides (.husk.local/, .husk/local/) are never attached to AI or exported. Copy this into your .gitignore — Husk will not modify Git files on its own.">
            <CfgBlock value={GITIGNORE_SUGGESTION} onChange={() => {}} rows={4} readOnly />
          </CfgRow>
          <CfgRow>
            <CfgAct
              onClick={() => {
                void navigator.clipboard.writeText(GITIGNORE_SUGGESTION).then(() =>
                  toast({ title: "Copied", message: "Paste it into your .gitignore", variant: "success" }),
                );
              }}
            >
              copy suggestion
            </CfgAct>
          </CfgRow>
        </>
      )}
    </ConfigEditor>
  );
}
