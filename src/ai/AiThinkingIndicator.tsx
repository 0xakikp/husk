/**
 * A subtle "AI is thinking…" indicator used while streaming responses.
 * Expanding ring pulses + a muted label. Replaces the bare pulse bar in all
 * AI surfaces (bubble, mini window, editor pane).
 */
export function AiThinkingIndicator({ label = "AI is thinking…" }: { label?: string }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}
