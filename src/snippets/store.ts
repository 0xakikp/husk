export type Snippet = { id: string; name: string; content: string };

const LS_KEY = "huskv2.snippets";

export function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Snippet[]) : [];
  } catch {
    return [];
  }
}

export function saveSnippets(list: Snippet[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable
  }
}

export function newSnippetId(): string {
  return `snip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
