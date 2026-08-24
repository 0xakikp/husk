import { readFile } from "../fs";
import { isNoteFile, loadNotesTree, type FileNode } from "./store";

export type VaultSection = {
  id: string;
  path: string;
  name: string;
  heading: string;
  startLine: number;
  endLine: number;
  text: string;
};

export type VaultLensResult = VaultSection & {
  preview: string;
  score: number;
  matchedTerms: string[];
};

const MAX_NOTES = 400;
const MAX_NOTE_CHARS = 160_000;
const MAX_RESULTS = 16;

const STOP_WORDS = new Set([
  "a", "about", "an", "and", "are", "did", "do", "find", "for", "from",
  "how", "i", "in", "is", "it", "my", "notes", "of", "on", "previously",
  "the", "this", "to", "was", "what", "where", "with", "write", "wrote",
]);

function cleanHeading(value: string): string {
  return value.replace(/\s+#+\s*$/, "").trim() || "Opening";
}

/** Split Markdown into addressable sections. Line numbers are intentionally
 * retained so a Lens result can open the editor at the cited passage rather
 * than merely opening the file. */
export function parseVaultSections(path: string, name: string, source: string): VaultSection[] {
  const lines = source.slice(0, MAX_NOTE_CHARS).split(/\r?\n/);
  const headings: Array<{ index: number; heading: string }> = [];
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) headings.push({ index, heading: cleanHeading(match[2]) });
  });

  const boundaries = headings.length > 0
    ? [
        ...(headings[0].index > 0 ? [{ index: 0, heading: "Opening" }] : []),
        ...headings,
      ]
    : [{ index: 0, heading: "Note" }];

  return boundaries.flatMap((boundary, index): VaultSection[] => {
    const next = boundaries[index + 1]?.index ?? lines.length;
    const text = lines.slice(boundary.index, next).join("\n").trim();
    if (!text) return [];
    const startLine = boundary.index + 1;
    return [{
      id: `${path}:${startLine}`,
      path,
      name,
      heading: boundary.heading,
      startLine,
      endLine: Math.max(startLine, next),
      text,
    }];
  });
}

function collectNoteNodes(nodes: FileNode[], out: FileNode[]) {
  for (const node of nodes) {
    if (out.length >= MAX_NOTES) return;
    if (node.isDirectory) collectNoteNodes(node.children ?? [], out);
    else if (isNoteFile(node.name)) out.push(node);
  }
}

/** Build a bounded, in-memory index from the configured Vault only. */
export async function buildVaultIndex(root: string): Promise<VaultSection[]> {
  const nodes: FileNode[] = [];
  collectNoteNodes(await loadNotesTree(root), nodes);
  const settled = await Promise.all(nodes.map(async (node) => {
    try {
      return parseVaultSections(node.path, node.name, await readFile(node.path));
    } catch {
      return [];
    }
  }));
  return settled.flat();
}

function normalizedTerms(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const term = value.toLowerCase().replace(/[^\p{L}\p{N}_.+/# -]/gu, " ").replace(/\s+/g, " ").trim();
    if (!term || term.length > 64 || STOP_WORDS.has(term)) continue;
    unique.add(term);
    if (unique.size >= 16) break;
  }
  return [...unique];
}

export function queryTerms(query: string): string[] {
  return normalizedTerms([
    query,
    ...query.split(/[^\p{L}\p{N}_.+/#-]+/gu),
  ]);
}

export function parseVaultLensExpansion(raw: string): string[] {
  const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const parsed = JSON.parse(json) as { terms?: unknown };
    return Array.isArray(parsed.terms)
      ? normalizedTerms(parsed.terms.filter((term): term is string => typeof term === "string"))
      : [];
  } catch {
    return [];
  }
}

function occurrenceScore(haystack: string, needle: string, weight: number): number {
  if (!needle || !haystack.includes(needle)) return 0;
  let count = 0;
  let offset = 0;
  while (count < 4) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + needle.length;
  }
  return weight * count;
}

function resultPreview(section: VaultSection, matchedTerms: string[]): string {
  const body = section.text
    .replace(/^#{1,6}\s+.*$/m, "")
    .replace(/```[\s\S]*?```/g, (block) => block.slice(0, 180))
    .replace(/\s+/g, " ")
    .trim();
  const lower = body.toLowerCase();
  const first = matchedTerms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - 55);
  const end = Math.min(body.length, start + 220);
  return `${start > 0 ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}`;
}

/** Rank sections locally. AI contributes only related search terms; note text
 * never has to leave the device for Vault Lens to work. */
export function rankVaultSections(
  sections: VaultSection[],
  query: string,
  expandedTerms: string[] = [],
  limit = MAX_RESULTS,
): VaultLensResult[] {
  const directTerms = queryTerms(query);
  const expansion = normalizedTerms(expandedTerms).filter((term) => !directTerms.includes(term));
  const phrase = query.toLowerCase().trim();

  return sections.flatMap((section): VaultLensResult[] => {
    const heading = section.heading.toLowerCase();
    const text = section.text.toLowerCase();
    let score = 0;
    const matched: string[] = [];

    if (phrase.length >= 4) {
      score += occurrenceScore(heading, phrase, 30);
      score += occurrenceScore(text, phrase, 12);
    }
    for (const term of directTerms) {
      const termScore = occurrenceScore(heading, term, 10) + occurrenceScore(text, term, 3);
      if (termScore > 0) matched.push(term);
      score += termScore;
    }
    for (const term of expansion) {
      const termScore = occurrenceScore(heading, term, 5) + occurrenceScore(text, term, 1.5);
      if (termScore > 0) matched.push(term);
      score += termScore;
    }
    if (score <= 0) return [];
    return [{
      ...section,
      score,
      matchedTerms: [...new Set(matched)].slice(0, 4),
      preview: resultPreview(section, matched),
    }];
  }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

