import { readDir, readFile } from "../fs";

interface CodebaseIndexEntry {
  path: string;
  content: string;
  lines: string[];
  size: number;
  mtime: number;
}

let index: Map<string, CodebaseIndexEntry> | null = null;
let indexRoot: string | null = null;

/** Get the indexed root directory. */
export function getIndexedRoot(): string | null {
  return indexRoot;
}

/** Build or refresh the codebase index for a given root directory. */
export async function buildCodebaseIndex(root: string): Promise<void> {
  const entries = new Map<string, CodebaseIndexEntry>();
  const ignorePatterns = [
    /node_modules/,
    /\.git/,
    /\.next/,
    /dist/,
    /build/,
    /target/,
    /vendor/,
    /\.husk/,
    /\.hermes/,
    /\.cargo/,
    /\.rustup/,
    /\.npm/,
    /\.pnpm/,
    /\.yarn/,
    /\.turbo/,
    /\.cache/,
    /coverage/,
    /\.nyc_output/,
    /\.pytest_cache/,
    /__pycache__/,
    /\.egg-info/,
    /\.tox/,
    /\.venv/,
    /venv/,
    /env/,
    /\.env/,
    /\.env\./,
    /\.DS_Store/,
    /Thumbs\.db/,
    /\.lock/,
    /package-lock\.json/,
    /yarn\.lock/,
    /pnpm-lock\.yaml/,
    /Cargo\.lock/,
    /poetry\.lock/,
    /Gemfile\.lock/,
    /\.min\./,
    /\.map$/,
    /\.wasm$/,
    /\.ico$/,
    /\.png$/,
    /\.jpg$/,
    /\.jpeg$/,
    /\.gif$/,
    /\.svg$/,
    /\.mp3$/,
    /\.mp4$/,
    /\.avi$/,
    /\.mov$/,
    /\.zip$/,
    /\.tar$/,
    /\.gz$/,
    /\.rar$/,
    /\.7z$/,
    /\.pdf$/,
    /\.doc$/,
    /\.docx$/,
    /\.xls$/,
    /\.xlsx$/,
    /\.ppt$/,
    /\.pptx$/,
  ];

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

  async function scan(dir: string) {
    let items;
    try {
      items = await readDir(dir);
    } catch {
      return;
    }

    // Process in batches to avoid blocking the UI thread
    const batchSize = 50;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      for (const item of batch) {
        const fullPath = dir + "/" + item.name;
        const relPath = fullPath.slice(root.length + 1);

        if (ignorePatterns.some((p) => p.test(relPath) || p.test(item.name))) {
          continue;
        }

        if (item.is_dir) {
          await scan(fullPath);
        } else {
          const ext = item.name.slice(item.name.lastIndexOf(".")).toLowerCase();
          if (!textExtensions.includes(ext)) continue;

          try {
            const content = await readFile(fullPath);
            if (content.length > 500_000) continue; // Skip huge files

            const lines = content.split("\n");
            entries.set(relPath, {
              path: relPath,
              content,
              lines,
              size: content.length,
              mtime: Date.now(),
            });
          } catch {
            // Skip unreadable files
          }
        }
      }
      // Yield to the event loop every batch
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  await scan(root);
  index = entries;
  indexRoot = root;
}

/** Get the current index, or null if not built. */
export function getCodebaseIndex(): Map<string, CodebaseIndexEntry> | null {
  return index;
}

/** Clear the index. */
export function clearCodebaseIndex(): void {
  index = null;
  indexRoot = null;
}

export interface SearchResult {
  path: string;
  score: number;
  matches: { line: number; text: string }[];
  snippet: string;
}

/** Search the codebase for files matching a query. */
export function searchCodebase(query: string, limit = 10): SearchResult[] {
  if (!index || index.size === 0) {
    return [];
  }

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1 && !["the", "and", "or", "in", "on", "at", "to", "for", "of", "with", "by", "is", "are", "was", "were", "be", "been", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "a", "an", "this", "that", "these", "those", "it", "its", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between", "under", "again", "further", "then", "once", "here", "there", "when", "where", "why", "how", "all", "any", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "now"].includes(t));

  if (terms.length === 0) {
    return [];
  }

  const results: SearchResult[] = [];

  for (const entry of index.values()) {
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
        matches.push({ line: i + 1, text: line.trim() });
      }
    }

    // Boost for function/class definitions containing query terms
    const definitionPatterns = [
      new RegExp(`(?:function|class|interface|type|const|let|var|def|fn|func|method|struct|enum|trait|impl|async|export|import|from|require)\s+.*(?:${terms.join("|")})`, "i"),
      new RegExp(`(?:${terms.join("|")})\s*[:=]\s*(?:function|class|=>|\{)`, "i"),
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
        snippet = entry.lines.slice(startLine, endLine).join("\n");
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

  return results.slice(0, limit);
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
