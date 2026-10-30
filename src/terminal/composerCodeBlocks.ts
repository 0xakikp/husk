import { maskWorkflowProposals } from "../ai/workflowProposals";

/** Workflow protocol text is review data, never a source of Run/capture tabs.
 * Keep the existing code-block format while excluding conservative workflow
 * spans, including malformed examples the Markdown card parser won't accept. */
export function parseComposerCodeBlocks(text: string): { lang: string; code: string }[] {
  const blocks: { lang: string; code: string }[] = [];
  const masked = maskWorkflowProposals(text);
  const regex = /```([\w-]*)\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(masked)) !== null) {
    // Never display or offer a runnable, partially removed surrounding script.
    if (text.slice(match.index, regex.lastIndex) !== match[0]) continue;
    const lang = (match[1] || "").toLowerCase();
    // Unlabelled code is not implicitly shell; edit proposals have their own UI.
    if (lang !== "husk-edit") blocks.push({ lang, code: match[2].trim() });
  }
  return blocks;
}
