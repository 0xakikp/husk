import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Cancel01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { toast } from "../toast";
import { DEV_TOOL_MODES, transformDevValue, type DevToolMode, type JsonOperation } from "./transforms";

const placeholders: Record<DevToolMode, string> = {
  json: '{ "project": "husk" }',
  jwt: "eyJhbGciOi...",
  base64: "Text to encode, or Base64 to decode",
  url: "Text or URL component to encode",
  uuid: "No input needed",
  timestamp: "1723276800 or 2026-08-10T00:00:00Z",
};

export function DevToolsView({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<DevToolMode>("json");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jsonOperation, setJsonOperation] = useState<JsonOperation>("format");
  const [decode, setDecode] = useState(false);

  const selectMode = (next: DevToolMode) => {
    setMode(next);
    setInput("");
    setOutput("");
    setNote(null);
    setError(null);
    setDecode(false);
  };

  const transform = () => {
    try {
      const result = transformDevValue(mode, input, { jsonOperation, decode });
      setOutput(result.output);
      setNote(result.note ?? null);
      setError(null);
    } catch (reason) {
      setOutput("");
      setNote(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const copy = async () => {
    if (!output) return;
    try {
      await writeText(output);
      toast({ title: "Result copied", variant: "success" });
    } catch (reason) {
      toast({ title: "Could not copy result", message: String(reason), variant: "error" });
    }
  };

  const actionLabel = mode === "uuid" ? "Generate UUID" : mode === "jwt" ? "Decode JWT" : mode === "timestamp" ? "Convert time" : mode === "json" ? (jsonOperation === "minify" ? "Minify JSON" : "Format JSON") : decode ? "Decode" : "Encode";
  const expectsInput = mode !== "uuid";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <button type="button" onClick={onBack} title="Back to plugins" className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground">
          <HugeiconsIcon icon={ArrowLeft01Icon} size={13} strokeWidth={2} />
        </button>
        <span className="truncate text-xs font-semibold text-primary">Dev Tools</span>
        <span className="ml-auto text-[9px] text-muted-foreground">local only</span>
      </header>

      <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-border/30 p-1.5">
        {DEV_TOOL_MODES.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => selectMode(tool.id)}
            className={cn(
              "rounded-md border px-2 py-1.5 text-left transition-colors",
              mode === tool.id ? "border-primary/55 bg-primary/10 text-foreground" : "border-border/40 bg-card/20 text-muted-foreground hover:border-border/70 hover:text-foreground",
            )}
          >
            <span className={cn("block text-[10px] font-medium", mode === tool.id && "text-primary")}>{tool.label}</span>
            <span className="block truncate text-[8.5px] opacity-75">{tool.hint}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {mode === "json" ? (
            <>
              <span className="text-[9px] text-muted-foreground">JSON mode</span>
              {(["format", "minify"] as JsonOperation[]).map((operation) => <button key={operation} type="button" onClick={() => setJsonOperation(operation)} className={cn("rounded px-1.5 py-0.5 text-[9px] transition-colors", jsonOperation === operation ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>{operation}</button>)}
            </>
          ) : mode === "base64" || mode === "url" ? (
            <>
              <span className="text-[9px] text-muted-foreground">Direction</span>
              <button type="button" onClick={() => setDecode(false)} className={cn("rounded px-1.5 py-0.5 text-[9px] transition-colors", !decode ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>encode</button>
              <button type="button" onClick={() => setDecode(true)} className={cn("rounded px-1.5 py-0.5 text-[9px] transition-colors", decode ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>decode</button>
            </>
          ) : mode === "jwt" ? <span className="text-[9px] text-amber-300/90">Decode only; no signature verification.</span> : <span className="text-[9px] text-muted-foreground">Nothing is sent outside Husk.</span>}
        </div>

        {expectsInput ? (
          <label className="block">
            <span className="mb-1 block text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Input</span>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={placeholders[mode]} spellCheck={false} className="box-border h-28 w-full resize-y rounded-md border border-border/60 bg-background/70 p-2 font-mono text-[10px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/55 focus:border-primary/65" />
          </label>
        ) : (
          <div className="rounded-md border border-border/45 bg-card/25 p-2 text-[10px] leading-relaxed text-muted-foreground">Generate a standard UUID v4 locally. It is useful as an identifier, not as a secret.</div>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          <button type="button" onClick={transform} className="rounded bg-primary px-2 py-1 text-[9.5px] font-medium text-primary-foreground transition-colors hover:brightness-110">{actionLabel}</button>
          {(input || output || error) ? <button type="button" onClick={() => { setInput(""); setOutput(""); setNote(null); setError(null); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[9px] text-muted-foreground hover:bg-muted hover:text-foreground"><HugeiconsIcon icon={Cancel01Icon} size={10} />clear</button> : null}
        </div>

        {error ? <p className="mb-0 mt-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-[9.5px] leading-relaxed text-red-300">{error}</p> : null}
        {output ? (
          <label className="mt-3 block">
            <span className="mb-1 flex items-center justify-between text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Output <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 normal-case tracking-normal text-primary hover:underline"><HugeiconsIcon icon={Copy01Icon} size={10} />copy</button></span>
            <textarea readOnly value={output} spellCheck={false} className="box-border h-32 w-full resize-y rounded-md border border-border/55 bg-card/25 p-2 font-mono text-[10px] leading-relaxed text-foreground outline-none" />
            {note ? <span className="mt-1.5 block text-[9px] leading-relaxed text-amber-300/90">{note}</span> : null}
          </label>
        ) : null}
      </div>
    </div>
  );
}
