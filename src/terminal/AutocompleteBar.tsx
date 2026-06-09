import { cn } from "@/lib/utils";

interface Suggestion {
  command: string;
  highlight: string;
  rest: string;
}

interface Props {
  visible: boolean;
  suggestions: Suggestion[];
  selectedIndex: number;
  position: { x: number; y: number } | null;
  onSelect: (index: number) => void;
}

export function AutocompleteBar({
  visible,
  suggestions,
  selectedIndex,
  position,
  onSelect,
}: Props) {
  if (!visible || !position || suggestions.length === 0) return null;

  return (
    <div
      className="absolute z-50 min-w-[200px] max-w-[400px] overflow-hidden rounded-lg border border-border/60 bg-popover shadow-lg"
      style={{ left: position.x, top: position.y + 4 }}
    >
      <div className="flex flex-col py-1">
        {suggestions.map((s, i) => (
          <button
            key={`${s.command}-${i}`}
            type="button"
            onClick={() => onSelect(i)}
            className={cn(
              "flex items-center gap-0 px-2.5 py-1 text-left text-[12px] transition-colors",
              i === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-accent/50"
            )}
          >
            <span className="font-medium">{s.highlight}</span>
            <span className="text-muted-foreground">{s.rest}</span>
          </button>
        ))}
      </div>
      <div className="border-t border-border/30 px-2.5 py-1 text-[9px] text-muted-foreground">
        Tab to accept · ↑↓ to navigate · Esc to dismiss
      </div>
    </div>
  );
}
