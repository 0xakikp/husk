import type { SubscriptionEditProposal } from "./subscriptionEdits";

const MAX_AUTO_PROPOSALS = 4;
const MAX_AUTO_CHARS = 100_000;

const PROTECTED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  ".next",
  "coverage",
  ".github",
  ".vscode",
  ".ssh",
  ".aws",
  ".gnupg",
  ".husk",
]);

const PROTECTED_FILE_NAMES = new Set([
  "credentials",
  "credentials.json",
  "secret",
  "secrets",
  "id_rsa",
  "authorized_keys",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "cargo.lock",
  "package.json",
  "tsconfig.json",
  "cargo.toml",
  "dockerfile",
  "docker-compose.yml",
]);

function isProtectedPath(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  const name = (parts[parts.length - 1] || "").toLowerCase();
  if (parts.slice(0, -1).some((part) => PROTECTED_DIRECTORY_NAMES.has(part.toLowerCase()))) return true;
  if (name.startsWith(".env") || name.endsWith(".pem") || name.endsWith(".key")) return true;
  return PROTECTED_FILE_NAMES.has(name);
}

/** Auto-apply is deliberately narrower than reviewed edits. The parser has
 * already enforced the workspace boundary; this layer limits surprise and
 * leaves configuration, secrets, generated output, and dependency trees for
 * the normal review flow. */
export function canAutoApplySubscriptionEdits(proposals: SubscriptionEditProposal[]): {
  ok: boolean;
  reason?: string;
} {
  if (proposals.length === 0) return { ok: false, reason: "no edit proposals" };
  if (proposals.length > MAX_AUTO_PROPOSALS) {
    return { ok: false, reason: `more than ${MAX_AUTO_PROPOSALS} files` };
  }
  let chars = 0;
  for (const proposal of proposals) {
    if (isProtectedPath(proposal.path)) {
      return { ok: false, reason: "a protected file or folder is included" };
    }
    chars += proposal.kind === "create"
      ? proposal.content.length
      : proposal.search.length + proposal.replace.length;
  }
  if (chars > MAX_AUTO_CHARS) return { ok: false, reason: "the change is too large" };
  return { ok: true };
}
