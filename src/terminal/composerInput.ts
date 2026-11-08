export type ComposerKeyAction = "next" | "previous" | "choose" | "dismiss" | "send" | "close" | null;

export function composerKeyAction(
  event: { key: string; shiftKey: boolean; isComposing?: boolean; keyCode?: number },
  paletteOpen: boolean, choiceCount: number, docked: boolean,
): ComposerKeyAction {
  // Safari may report compositionend before the confirming keydown.
  if (event.isComposing || event.keyCode === 229) return null;
  if (paletteOpen) {
    if (event.key === "Escape") return "dismiss";
    if (choiceCount > 0) {
      if (event.key === "ArrowDown") return "next";
      if (event.key === "ArrowUp") return "previous";
      if (event.key === "Enter" && !event.shiftKey) return "choose";
    }
  }
  if (event.key === "Enter" && !event.shiftKey) return "send";
  if (event.key === "Escape" && docked) return "close";
  return null;
}

/** Tool receipts are evidence, not questions to repeat through Ask again. */
export function previousUserQuestion(messages: readonly { role: string; content: string; kind?: string }[], replyIndex: number): string | null {
  for (let index = replyIndex - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "user" && !message.kind && message.content.trim()) return message.content;
  }
  return null;
}
