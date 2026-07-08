import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, ComputerTerminal02Icon } from "@hugeicons/core-free-icons";
import { usePrefs } from "../settings/preferences";
import { loadConfig, getKey } from "../ai/store";
import { getProvider } from "../ai/providers";
import { streamChat } from "../ai/client";
import { getActiveAgent } from "../ai/agents";
import { readActiveTerminal, runInActiveTerminal } from "../ai/terminalContext";
import { registerComposerToggle, registerComposerOpen } from "../ai/bubbleStore";

interface CodeBlock {
  lang: string;
  code: string;
}

function parseCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ lang: match[1] || "sh", code: match[2].trim() });
  }
  return blocks;
}

function stripCodeBlocks(text: string): string {
  return text.replace(/```(\w*)\n?([\s\S]*?)```/g, "").trim();
}

export function TerminalAiComposer() {
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(false);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return registerComposerToggle(() => setOpen((v) => !v));
  }, []);

  useEffect(() => {
    return registerComposerOpen((text) => {
      setOpen(true);
      if (text) setInput(text);
      setTimeout(() => textareaRef.current?.focus(), 50);
    });
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput("");
    setResponse("");
    setBusy(true);
    abortRef.current = false;
    abortCtrlRef.current?.abort();
    abortCtrlRef.current = new AbortController();

    const cfg = loadConfig();
    const provider = getProvider(cfg.providerId);
    const apiKey = getKey(provider.id);
    if (!provider.keyless && !apiKey) {
      setResponse(`⚠️ Set a ${provider.label} API key in Settings → Models first.`);
      setBusy(false);
      return;
    }

    const ctx = readActiveTerminal();
    const agent = getActiveAgent();
    let system =
      agent.systemPrompt +
      "\n\nYou are a helpful terminal assistant. The user is working in a terminal. Respond concisely. If you suggest a shell command, wrap it in a code block.";
    if (ctx) {
      system += `\n\nActive terminal output:\n\`\`\`\n${ctx}\n\`\`\``;
    }

    try {
      await streamChat(
        {
          provider,
          model: cfg.model || agent.model || provider.defaultModel,
          apiKey,
          baseURL: cfg.baseURL,
        },
        system,
        [{ role: "user", content: text }],
        (delta) => {
          if (abortRef.current) return;
          setResponse((prev) => prev + delta);
        },
        {},
        abortCtrlRef.current.signal,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResponse((prev) => prev + `\n\n⚠️ ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [input, busy]);

  const handleClose = () => {
    abortRef.current = true;
    abortCtrlRef.current?.abort();
    setOpen(false);
    setInput("");
    setResponse("");
    setBusy(false);
  };

  const runCommand = (cmd: string) => {
    runInActiveTerminal(cmd);
  };

  const textParts = response ? stripCodeBlocks(response) : "";
  const codeBlocks = response ? parseCodeBlocks(response) : [];

  if (!open || !prefs.aiEnabled) return null;

  return (
    <div className="shrink-0 border-t border-border/60 bg-card/95 p-2.5 shadow-lg backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">AI</span>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
            if (e.key === "Escape") {
              handleClose();
            }
          }}
          placeholder="Ask AI about this terminal..."
          rows={1}
          className="min-h-[28px] max-h-[120px] flex-1 resize-none rounded-md border border-border/40 bg-muted/30 px-2 py-1 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/40"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40"
        >
          {busy ? "..." : "Ask"}
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="shrink-0 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Close"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </button>
      </div>

      {response && (
        <div className="mt-2.5 max-h-[220px] overflow-y-auto rounded-md border border-border/40 bg-muted/20 p-2.5 text-[12px]">
          {textParts && (
            <div className="mb-2 whitespace-pre-wrap leading-relaxed text-foreground">{textParts}</div>
          )}
          {codeBlocks.map((block, i) => (
            <div key={i} className="mb-2 overflow-hidden rounded-md border border-border/40 bg-black/60 p-2 last:mb-0">
              <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="font-mono uppercase">{block.lang}</span>
                <button
                  type="button"
                  onClick={() => runCommand(block.code)}
                  className="inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-primary hover:bg-primary/30"
                >
                  <HugeiconsIcon icon={ComputerTerminal02Icon} size={10} strokeWidth={1.75} />
                  Run
                </button>
              </div>
              <pre className="overflow-x-auto font-mono text-[11px] text-foreground/90">
                <code>{block.code}</code>
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
