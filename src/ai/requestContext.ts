import { byteLength, fitWithinBudget, scanForSecrets, totalBytes, type AiContextItem } from "./contextItems";
import type { ChatMessage } from "./client";

export type SendChoices = { fitToBudget?: boolean; allowSensitive?: boolean };
export type PreparedSend = { text: string; items: AiContextItem[]; choices: SendChoices };

/** Refresh first, then freeze the exact data reviewed by the user. */
export async function prepareSendContext(
  text: string,
  items: AiContextItem[],
  readEditorFile: (path: string) => Promise<string>,
): Promise<PreparedSend> {
  const refreshed = await Promise.all(items.map(async (item) => {
    const preview = item.kind === "editor-file" ? await readEditorFile(item.source) : item.preview;
    const reasons = item.isImage ? [] : scanForSecrets(`${item.label} ${item.source}`, preview);
    return { ...item, preview, bytes: byteLength(preview), sensitive: reasons.length > 0, sensitiveReasons: reasons };
  }));
  return { text, items: refreshed, choices: {} };
}

export function reviewSendContext(prepared: PreparedSend, budgetKb: number) {
  const fits = prepared.choices.fitToBudget ? fitWithinBudget(prepared.items, budgetKb) : { kept: prepared.items, dropped: [] };
  return {
    items: fits.kept,
    dropped: fits.dropped,
    overBudget: !prepared.choices.fitToBudget && totalBytes(prepared.items) > budgetKb * 1024,
    sensitive: prepared.choices.allowSensitive ? [] : fits.kept.filter((item) => item.sensitive),
  };
}

export function imageInputs(items: AiContextItem[]): NonNullable<ChatMessage["images"]> {
  return items.filter((item) => item.isImage).map((item) => {
    // Accept old in-memory attachment previews during hot reload as well.
    const dataUrl = item.preview.startsWith("data:") ? item.preview : item.preview.match(/\((data:image\/[^)]+)\)$/)?.[1];
    if (!dataUrl || !/^data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=\r\n]+$/.test(dataUrl)) {
      throw new Error(`Unsupported image: ${item.label}. Use PNG, JPEG, WebP, or GIF.`);
    }
    return { dataUrl, mediaType: dataUrl.slice(5, dataUrl.indexOf(";")) };
  });
}

/** Conservative estimate: two UTF-8 bytes per token, plus an image allowance.
 * Unknown/local model windows use a small default. History remains saved;
 * callers visibly report any whole older turns omitted from this request. */
export function boundConversation(system: string, messages: ChatMessage[], contextWindow?: string) {
  const match = contextWindow?.match(/^(\d+(?:\.\d+)?)(K|M)$/i);
  const windowTokens = match ? Number(match[1]) * (match[2].toUpperCase() === "M" ? 1_000_000 : 1_000) : 8192;
  const reserve = Math.min(4096, Math.floor(windowTokens / 3));
  const budget = Math.min(96_000, (windowTokens - reserve) * 2);
  const cost = (message: ChatMessage) => byteLength(message.content) + (message.images?.length ?? 0) * 8192 + 32;
  let first = Math.max(0, messages.length - 1);
  let used = byteLength(system) + (messages[first] ? cost(messages[first]) : 0) + 256;
  if (used > budget) throw new Error("This request is too large for the selected model. Remove attachments, shorten the message, or select a model with a larger context window.");
  while (first > 0) {
    let start = first - 1;
    while (start > 0 && messages[start].role !== "user") start--;
    const size = messages.slice(start, first).reduce((sum, message) => sum + cost(message), 0);
    if (used + size > budget) break;
    used += size;
    first = start;
  }
  return { messages: messages.slice(first), omitted: first };
}
