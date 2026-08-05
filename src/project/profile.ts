import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

import { getWorkspaceRoot, subscribeWorkspaceRoot } from "../workspace/store";

/**
 * Project profile — per-repository instructions, runbooks, and safety rules
 * living in `<workspaceRoot>/.husk/`. Loaded when the workspace root changes;
 * never mixed with personal settings.
 */

export type Runbook = {
  id?: string;
  title?: string;
  description?: string;
  command?: string;
  cwd?: string;
  confirm?: boolean;
  tags?: string[];
};

export type SafetySection = {
  protected_environments?: string[];
  protected_git_branches?: string[];
  protected_kubernetes_contexts?: string[];
  protected_aws_profiles?: string[];
};

export type ProjectProfile = {
  exists: boolean;
  enabled: boolean;
  name: string | null;
  default_runbook: string | null;
  include_instructions: boolean;
  instructions: string;
  runbooks: Runbook[];
  environments_raw: string;
  safety: SafetySection | null;
  husk_dir: string;
};

let profile: ProjectProfile | null = null;
let loading = false;
const subscribers = new Set<() => void>();

function emit(): void {
  for (const fn of subscribers) fn();
}

export function getProjectProfile(): ProjectProfile | null {
  return profile;
}

export function subscribeProjectProfile(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function useProjectProfile(): ProjectProfile | null {
  return useSyncExternalStore(subscribeProjectProfile, getProjectProfile);
}

export async function reloadProjectProfile(): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    if (profile !== null) {
      profile = null;
      emit();
    }
    return;
  }
  loading = true;
  try {
    profile = await invoke<ProjectProfile>("project_profile_load", { root });
  } catch (e) {
    console.warn("[husk] project profile load failed:", e);
    profile = null;
  } finally {
    loading = false;
  }
  emit();
}

/** Call once at app start: the profile follows the workspace root. */
export function initProjectProfileTracking(): void {
  subscribeWorkspaceRoot(() => void reloadProjectProfile());
  void reloadProjectProfile();
}

/* ── Writes — every one returns the fresh profile from Rust ─────────────── */

async function apply(promise: Promise<ProjectProfile>): Promise<ProjectProfile> {
  const next = await promise;
  profile = next;
  emit();
  return next;
}

export function initializeProjectProfile(): Promise<ProjectProfile> {
  return apply(invoke<ProjectProfile>("project_profile_init", { root: getWorkspaceRoot() }));
}

export function saveProjectInstructions(content: string): Promise<ProjectProfile> {
  return apply(invoke<ProjectProfile>("project_profile_write_instructions", { root: getWorkspaceRoot(), content }));
}

export function setProjectProfileEnabled(enabled: boolean): Promise<ProjectProfile> {
  return apply(invoke<ProjectProfile>("project_profile_set_enabled", { root: getWorkspaceRoot(), enabled }));
}

export function saveRunbook(runbook: Runbook): Promise<ProjectProfile> {
  return apply(invoke<ProjectProfile>("project_runbook_save", { root: getWorkspaceRoot(), runbook }));
}

export function deleteRunbook(id: string): Promise<ProjectProfile> {
  return apply(invoke<ProjectProfile>("project_runbook_delete", { root: getWorkspaceRoot(), id }));
}

export function isProjectProfileLoading(): boolean {
  return loading;
}

/**
 * Suggested .gitignore additions. Offered for copy — Husk never modifies Git
 * files on its own.
 */
export const GITIGNORE_SUGGESTION = `# Husk project profile — machine-local overrides stay on this machine
.husk/local/
.husk.local/
`;
