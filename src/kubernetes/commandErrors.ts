export type MissingCredentialHelper = {
  executable: string;
  title: string;
  guidance: string;
};

/** Recognize a missing exec credential plugin, not expired credentials or RBAC denial. */
export function missingCredentialHelper(message: string): MissingCredentialHelper | null {
  const match = /\bexec:\s+executable\s+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"'`]+))\s+not found\b/.exec(message);
  const command = match?.[1] || match?.[2] || match?.[3];
  if (!command || command.length > 512 || !/^[A-Za-z0-9_./\\ :+-]+$/.test(command)) return null;
  const executable = command.split(/[/\\]/).pop() || "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(executable)) return null;
  const isAws = /^aws(?:\.exe)?$/i.test(executable);
  return {
    executable,
    title: isAws ? "AWS CLI unavailable to Husk" : `Authentication helper “${executable}” unavailable to Husk`,
    guidance: isAws
      ? "Husk could not find the AWS CLI required by this kubeconfig. If it works in your terminal, restart Husk after checking your login-shell PATH. Otherwise install the AWS CLI. Profile selection and AWS login are separate checks."
      : `Husk could not find the “${executable}” credential helper required by this kubeconfig. Make it available on your login-shell PATH, then restart Husk.`,
  };
}

/** Keep generic errors intact; avoid repeating kubectl discovery retries for a known cause. */
export function kubernetesCommandError(message: string): string {
  const missing = missingCredentialHelper(message);
  return missing ? `${missing.title}. Authentication could not start. ${missing.guidance}` : message;
}

/** Bound rendered diagnostics independently of the native command-output limit. */
export function boundedK8sDiagnostic(message: string): string {
  const clean = message.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").trim();
  return clean.length > 8192 ? `${clean.slice(0, 8192)}\n[Diagnostic truncated]` : clean;
}
