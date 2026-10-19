import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getTerminalContextSnapshot } from "./registry";
import type { TerminalStatusSnapshot } from "./statusBarState";

export type TerminalContexts = Readonly<{
  kubernetes: { context: string; namespace: string | null; source: "config" } | null;
  docker: { context: string; source: "config" | "shell" } | null;
  kubernetesReason: string | null;
  dockerReason: string | null;
}>;

const unavailable = (reason: string): TerminalContexts => ({
  kubernetes: null, docker: null, kubernetesReason: reason, dockerReason: reason,
});
const windowHidden = () => document.visibilityState === "hidden";
const safeText = (value: unknown): value is string => typeof value === "string"
  && value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 512
  && !/[\x00-\x1f\x7f-\x9f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(value);

/** Validate the native boundary and discard all unrequested/unrecognized data. */
export function parseTerminalContexts(value: unknown, enabled: { kubernetes: boolean; docker: boolean }): TerminalContexts {
  if (!value || typeof value !== "object") return unavailable("Context configuration could not be read.");
  const record = value as Partial<TerminalContexts>;
  const kube = record.kubernetes;
  const docker = record.docker;
  return {
    kubernetes: enabled.kubernetes && kube?.source === "config" && safeText(kube.context)
      && (kube.namespace === null || safeText(kube.namespace))
      ? { context: kube.context, namespace: kube.namespace, source: "config" } : null,
    docker: enabled.docker && docker && (docker.source === "config" || docker.source === "shell") && safeText(docker.context)
      ? { context: docker.context, source: docker.source } : null,
    kubernetesReason: safeText(record.kubernetesReason) ? record.kubernetesReason : null,
    dockerReason: safeText(record.dockerReason) ? record.dockerReason : null,
  };
}

/** Read only the focused local shell's declared configuration. No executable,
 * inherited app environment, credential helper, account or daemon is queried.
 * Polling is bounded to one request at a time while the window is visible and
 * the terminal is at a prompt. A new prompt re-reads the reported paths. */
export function useTerminalContexts(
  snapshot: TerminalStatusSnapshot | null,
  connected: boolean,
  enabled: { kubernetes: boolean; docker: boolean },
): TerminalContexts {
  const eligible = connected && snapshot?.scope === "local" && snapshot.atPrompt
    && !snapshot.command && snapshot.startedAt === null && Boolean(snapshot.cwd)
    && (enabled.kubernetes || enabled.docker);
  const key = eligible ? JSON.stringify([
    snapshot!.leafId, snapshot!.scopeKey, snapshot!.cwd, snapshot!.promptRevision,
    enabled.kubernetes, enabled.docker,
  ]) : "";
  const [resolved, setResolved] = useState<{ key: string; result: TerminalContexts } | null>(null);
  const pending = useRef(false);
  const visibilityRevision = useRef(0);

  useEffect(() => {
    if (!key || !snapshot) { setResolved(null); return; }
    const leafId = snapshot.leafId;
    const cwd = snapshot.cwd;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled || pending.current || windowHidden()) return;
      const capture = getTerminalContextSnapshot(leafId);
      if (!capture.available || capture.leafId !== leafId || capture.cwd !== cwd) {
        setResolved({ key, result: unavailable(capture.available ? "The terminal folder changed." : capture.reason) });
        return;
      }
      const fingerprint = JSON.stringify(capture);
      const visibility = visibilityRevision.current;
      pending.current = true;
      try {
        const result = await invoke<unknown>("terminal_resolve_contexts", { request: {
          cwd: capture.cwd, kubeconfig: capture.kubeconfig, defaultKubeconfigPath: capture.defaultKubeconfigPath,
          dockerConfig: capture.dockerConfig, dockerContext: capture.dockerContext, dockerHost: capture.dockerHost,
          kubernetes: enabled.kubernetes, docker: enabled.docker,
        } });
        if (cancelled) return;
        // A late read cannot republish a target after Enter, SSH, a fresh PTY,
        // a directory/env change or switching the active pane.
        const current = getTerminalContextSnapshot(leafId);
        if (visibility !== visibilityRevision.current || windowHidden() || !current.available || JSON.stringify(current) !== fingerprint) {
          setResolved({ key, result: unavailable("Waiting for fresh terminal configuration.") });
          return;
        }
        setResolved({ key, result: parseTerminalContexts(result, enabled) });
      } catch {
        if (!cancelled) setResolved({ key, result: unavailable("Context configuration could not be read.") });
      } finally { pending.current = false; }
    };
    void refresh();
    // Re-read bounded local metadata to notice external context changes too.
    const timer = window.setInterval(() => void refresh(), 5_000);
    const onVisible = () => {
      visibilityRevision.current++;
      setResolved(null);
      if (!windowHidden()) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [key]);

  if (key && resolved?.key === key) return resolved.result;
  return unavailable(!connected ? "Terminal context is unavailable."
    : snapshot?.scope === "remote" ? "Remote configuration is not available; local defaults are never reused."
      : snapshot?.scope !== "local" ? "Terminal scope has not been verified."
        : !snapshot.atPrompt || snapshot.command || snapshot.startedAt !== null ? "Waiting for a local shell prompt."
          : "Waiting for terminal context metadata; existing shells may need to be reopened.");
}
