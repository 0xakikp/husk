/** Extract SEARCH/REPLACE edit blocks from AI responses. */

export interface CodeEdit {
  file: string;
  search: string;
  replace: string;
}

export function parseEdits(text: string): CodeEdit[] {
  const edits: CodeEdit[] = [];

  // Pattern: FILE: <path>\n<<<<<<< SEARCH\n<old>\n=======\n<new>\n>>>>>>> REPLACE
  const fileRegex = /FILE:\s*(.+?)\n<<<<<<<\s*SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>>\s*REPLACE/g;
  let m: RegExpExecArray | null;
  while ((m = fileRegex.exec(text)) !== null) {
    edits.push({
      file: m[1].trim(),
      search: m[2].replace(/\n$/, ""),
      replace: m[3].replace(/\n$/, ""),
    });
  }

  // Alternative: plain SEARCH/REPLACE without FILE header
  if (edits.length === 0) {
    const plainRegex = /<<<<<<<\s*SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>>\s*REPLACE/g;
    while ((m = plainRegex.exec(text)) !== null) {
      edits.push({ file: "", search: m[1].replace(/\n$/, ""), replace: m[2].replace(/\n$/, "") });
    }
  }

  return edits;
}

export function stripEditBlocks(text: string): string {
  return text
    .replace(/FILE:\s*.+?\n<<<<<<<\s*SEARCH\n[\s\S]*?\n=======\n[\s\S]*?\n>>>>>>>\s*REPLACE/g, "")
    .replace(/<<<<<<<\s*SEARCH\n[\s\S]*?\n=======\n[\s\S]*?\n>>>>>>>\s*REPLACE/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
