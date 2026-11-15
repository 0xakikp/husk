import { readDirScoped, readFileScoped } from "../fs";
import { normalizeWorkspacePath, resolveWorkspacePath } from "./workspaceScope";
import { watchFileChanges, watchRepositoryChanges } from "../editor/fileChanges";

interface CodebaseIndexEntry {
  path: string;
  content: string;
  lines: string[];
  size: number;
  mtime: number;
}

let index: Map<string, CodebaseIndexEntry> | null = null;
let indexRoot: string | null = null;
let indexedAt = 0;
let generation = 0;
const pendingRoots = new Map<string, number>();
const invalidationListeners = new Set<() => void>();
export type CodebaseCoverage = { partial: boolean; reasons: string[]; indexedFiles: number; skippedFiles: number };
const coverage = new WeakMap<Map<string, CodebaseIndexEntry>, CodebaseCoverage>();

export function getCodebaseCoverage(snapshot = index): CodebaseCoverage | null {
  return snapshot ? coverage.get(snapshot) ?? null : null;
}
export function isCodebaseIndexFresh(root: string): boolean {
  return index !== null && indexRoot === normalizeWorkspacePath(root) && Date.now() - indexedAt < 60_000;
}
export function subscribeCodebaseInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => { invalidationListeners.delete(listener); };
}
const within = (path: string, root: string) => path === root || path.startsWith(`${root.replace(/\/$/, "")}/`);
const invalidateChangedPath = (path: string) => {
  if ([...(indexRoot ? [indexRoot] : []), ...pendingRoots.keys()].some((root) => within(path, root) || within(root, path))) clearCodebaseIndex();
};
watchFileChanges(invalidateChangedPath);
watchRepositoryChanges(invalidateChangedPath);

const ignoredDirectories = new Set([
  "node_modules", ".git", ".next", "dist", "build", "target", "vendor",
  ".husk", ".hermes", ".cargo", ".rustup", ".npm", ".pnpm", ".yarn",
  ".turbo", ".cache", "coverage", ".nyc_output", ".pytest_cache", "__pycache__",
  ".tox", ".venv", "venv", "env", ".aws", ".ssh",
]);
const ignoredFiles = /^(?:\.env(?:\..*)?|\.DS_Store|Thumbs\.db|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|Gemfile\.lock)$|\.lock$|\.min\.|\.(?:map|wasm|ico|png|jpe?g|gif|svg|mp[34]|avi|mov|zip|tar|gz|rar|7z|pdf|docx?|xlsx?|pptx?)$/i;

/** Get the indexed root directory. */
export function getIndexedRoot(): string | null {
  return indexRoot;
}

/** Build or refresh the codebase index for a given root directory. */
export async function buildCodebaseIndex(root: string, options: { signal?: AbortSignal } = {}): Promise<Map<string, CodebaseIndexEntry>> {
  root = normalizeWorkspacePath(root);
  if (!root) throw new Error("Select an absolute workspace before searching.");
  const entries = new Map<string, CodebaseIndexEntry>();
  const builtGeneration = generation;
  const reasons = new Set<string>();
  let skippedFiles = 0;
  const started = Date.now();
  let scannedEntries = 0;
  let scannedDirectories = 0;
  let indexedBytes = 0;
  const maxBytes = 8 * 1024 * 1024;
  const encoder = new TextEncoder();
  const exhausted = () => {
    const limited = scannedEntries >= 5_000 || scannedDirectories >= 256 || entries.size >= 1_000 || indexedBytes >= maxBytes || Date.now() - started > 10_000;
    if (limited) reasons.add("Index scan limit reached");
    return limited;
  };
  const checkCancellation = () => {
    if (options.signal?.aborted) throw new Error("Workspace search was cancelled.");
    if (generation !== builtGeneration) throw new Error("Workspace changed while indexing. Search again for current results.");
  };

  const textExtensions = [
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".pyi", ".rb", ".php", ".go", ".rs",
    ".java", ".kt", ".scala", ".clj",
    ".c", ".cpp", ".h", ".hpp", ".cs",
    ".swift", ".m", ".mm",
    ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
    ".xml", ".sql", ".graphql", ".gql",
    ".sh", ".bash", ".zsh", ".fish", ".ps1",
    ".md", ".mdx", ".txt", ".rst",
    ".dockerfile", ".makefile", ".cmake",
    ".vue", ".svelte", ".astro",
    ".prisma", ".proto",
  ];

  async function scan(dir: string, depth = 0) {
    checkCancellation();
    if (depth > 12) { reasons.add("Folder depth limit reached"); return; }
    if (exhausted()) return;
    scannedDirectories += 1;
    let items;
    try {
      items = await readDirScoped(dir, root);
    } catch {
      reasons.add("Some folders could not be read");
      return;
    }

    // Process in batches to avoid blocking the UI thread
    const batchSize = 50;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      for (const item of batch) {
        checkCancellation();
        if (exhausted()) return;
        scannedEntries += 1;
        const fullPath = resolveWorkspacePath(`${dir.endsWith("/") ? dir : `${dir}/`}${item.name}`, root);
        if (!fullPath) continue;
        const relPath = fullPath.slice(root.endsWith("/") ? root.length : root.length + 1);

        // Match path components, not arbitrary substrings: environment.ts,
        // distribution.ts and buildPipeline.ts are ordinary source files.
        if (ignoredFiles.test(item.name) || (item.is_dir && (ignoredDirectories.has(item.name) || item.name.endsWith(".egg-info")))) {
          continue;
        }

        if (item.is_dir) {
          await scan(fullPath, depth + 1);
        } else {
          const ext = item.name.slice(item.name.lastIndexOf(".")).toLowerCase();
          if (!textExtensions.includes(ext)) continue;

          try {
            // The native check rejects symlink escapes before reading and caps
            // the read itself, rather than allocating an arbitrary-size file.
            const content = await readFileScoped(fullPath, root, 500_000);
            checkCancellation();
            const bytes = encoder.encode(content).byteLength;
            if (bytes > 500_000 || indexedBytes + bytes > maxBytes) { skippedFiles++; reasons.add("Some files exceeded the index size limit"); continue; }
            indexedBytes += bytes;

            const lines = content.split("\n");
            entries.set(relPath, {
              path: relPath,
              content,
              lines,
              size: content.length,
              mtime: Date.now(),
            });
          } catch {
            checkCancellation();
            skippedFiles++;
            reasons.add("Some files were unreadable or too large");
          }
        }
      }
      // Yield to the event loop every batch
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  pendingRoots.set(root, (pendingRoots.get(root) ?? 0) + 1);
  try {
    await scan(root);
    checkCancellation();
    coverage.set(entries, { partial: reasons.size > 0, reasons: [...reasons], indexedFiles: entries.size, skippedFiles });
    index = entries;
    indexRoot = root;
    indexedAt = Date.now();
    return entries;
  } finally {
    const remaining = (pendingRoots.get(root) ?? 1) - 1;
    if (remaining > 0) pendingRoots.set(root, remaining); else pendingRoots.delete(root);
  }
}

/** Get the current index, or null if not built. */
export function getCodebaseIndex(): Map<string, CodebaseIndexEntry> | null {
  return index;
}

/** Clear the index. */
export function clearCodebaseIndex(): void {
  index = null;
  indexRoot = null;
  indexedAt = 0;
  generation++;
  for (const listener of invalidationListeners) { try { listener(); } catch { /* Independent subscribers. */ } }
}

export interface SearchResult {
  path: string;
  score: number;
  matches: { line: number; text: string }[];
  snippet: string;
}

/** Search the codebase for files matching a query. */
export function searchCodebase(query: string, limit = 10, snapshot = index): SearchResult[] {
  if (!snapshot || snapshot.size === 0) {
    return [];
  }

  const terms = query.slice(0, 256)
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1 && !["the", "and", "or", "in", "on", "at", "to", "for", "of", "with", "by", "is", "are", "was", "were", "be", "been", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "a", "an", "this", "that", "these", "those", "it", "its", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "any", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "now"].includes(t));

  terms.splice(16);
  if (terms.length === 0) {
    return [];
  }

  const results: SearchResult[] = [];

  const escapedTerms = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  for (const entry of snapshot.values()) {
    let score = 0;
    const matches: { line: number; text: string }[] = [];
    const pathLower = entry.path.toLowerCase();

    // Path matching (high weight — filename often contains the keyword)
    for (const term of terms) {
      if (pathLower.includes(term)) {
        score += 10;
        if (entry.path.split("/").pop()?.toLowerCase().includes(term)) {
          score += 15; // Bonus for matching filename
        }
      }
    }

    // Content matching
    const contentLower = entry.content.toLowerCase();
    for (const term of terms) {
      const count = (contentLower.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      score += count * 2;
    }

    // Line-by-line matching with context
    for (let i = 0; i < entry.lines.length; i++) {
      const line = entry.lines[i];
      const lineLower = line.toLowerCase();
      let lineMatched = false;

      for (const term of terms) {
        if (lineLower.includes(term)) {
          lineMatched = true;
          score += 3;
        }
      }

      if (lineMatched) {
        if (matches.length < 5) matches.push({ line: i + 1, text: line.trim().slice(0, 600) });
      }
    }

    // Boost for function/class definitions containing query terms
    const definitionPatterns = [
      new RegExp(`(?:function|class|interface|type|const|let|var|def|fn|func|method|struct|enum|trait|impl|async|export|import|from|require)\\s+.*(?:${escapedTerms.join("|")})`, "i"),
      new RegExp(`(?:${escapedTerms.join("|")})\\s*[:=]\\s*(?:function|class|=>|\\{)`, "i"),
    ];
    for (const pattern of definitionPatterns) {
      if (pattern.test(entry.content)) {
        score += 20;
      }
    }

    if (score > 0) {
      // Build snippet around best match
      let snippet = "";
      if (matches.length > 0) {
        const firstMatch = matches[0];
        const startLine = Math.max(0, firstMatch.line - 3);
        const endLine = Math.min(entry.lines.length, firstMatch.line + 3);
        snippet = entry.lines.slice(startLine, endLine).join("\n").slice(0, 2_000);
      }

      results.push({
        path: entry.path,
        score,
        matches: matches.slice(0, 5), // Top 5 matches per file
        snippet,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, Math.max(1, Math.min(20, Number.isFinite(limit) ? Math.floor(limit) : 10)));
}

/** Format search results as markdown for the AI. */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No matching files found in the codebase.";
  }

  return results
    .map(
      (r, i) =>
        `**${i + 1}. ${r.path}** (score: ${r.score})\n` +
        (r.matches.length > 0
          ? r.matches.map((m) => `   Line ${m.line}: \`${m.text}\``).join("\n")
          : "") +
        (r.snippet
          ? `\n   \`\`\`\n   ${r.snippet.split("\n").join("\n   ")}\n   \`\`\``
          : "")
    )
    .join("\n\n");
}
