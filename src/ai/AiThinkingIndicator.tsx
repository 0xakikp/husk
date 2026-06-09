/**
 * A subtle "AI is thinking…" indicator used while streaming responses.
 * Three bouncing dots + a muted label. Replaces the bare pulse bar in all
 * AI surfaces (bubble, mini window, editor pane).
 */
export function AiThinkingIndicator({ label = "AI is thinking…" }: { label?: string }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="flex gap-0.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.30s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}
