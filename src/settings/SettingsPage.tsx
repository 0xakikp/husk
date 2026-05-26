import { useMemo, useState } from "react";
import { Search01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useAgents, upsertAgent, removeAgent, newAgentId, type Agent } from "../ai/agents";
import { GeneralSection } from "./GeneralSection";
import { AppearanceSection } from "./AppearanceSection";
import { AboutSection } from "./AboutSection";
import { ModelsSection } from "./ModelsSection";
import { McpSection } from "./McpSection";
import { ToolsSection } from "./ToolsSection";
import { SectionHeader } from "./components/SectionHeader";

type SectionId = "about" | "general" | "appearance" | "models" | "agents" | "mcp" | "tools";

const SECTIONS: { id: SectionId; label: string; keywords: string[] }[] = [
  { id: "about", label: "Manifest", keywords: ["about", "version", "build", "license"] },
  {
    id: "general",
    label: "General",
    keywords: ["terminal", "font", "size", "cursor", "blink", "theme"],
  },
  {
    id: "appearance",
    label: "Appearance",
    keywords: ["background", "image", "wallpaper", "opacity", "blur", "transparency", "dim"],
  },
  {
    id: "models",
    label: "Models",
    keywords: ["model", "provider", "api", "key", "ai", "anthropic", "openai", "local"],
  },
  {
    id: "agents",
    label: "Agents",
    keywords: ["agent", "persona", "prompt", "system", "assistant"],
  },
  {
    id: "mcp",
    label: "MCP",
    keywords: ["mcp", "server", "tool", "context", "protocol", "external"],
  },
  {
    id: "tools",
    label: "Tools",
    keywords: ["tool", "cli", "install", "recommended"],
  },
];

function scrollToSection(id: SectionId) {
  document
    .getElementById(`settings-section-${id}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.keywords.some((k) => k.includes(q)),
    );
  }, [search]);
  const show = (id: SectionId) => visible.some((s) => s.id === id);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground select-none">
      <div className="flex h-8 shrink-0 items-center justify-between bg-background px-3">
        <div className="flex items-center gap-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollToSection(s.id)}
              className="h-6 rounded-md px-2.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-44">
            <HugeiconsIcon
              icon={Search01Icon}
              size={14}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Find setting…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 rounded-full border-border/40 bg-muted/40 py-0 pl-8 pr-3 text-[11.5px]"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-7 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="mx-auto w-full max-w-160">
          {visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No settings match “{search}”
            </div>
          ) : null}
          {show("about") ? (
            <div id="settings-section-about" className="scroll-mt-6">
              <AboutSection />
            </div>
          ) : null}
          {show("general") ? (
            <>
              <SectionDivider />
              <div id="settings-section-general" className="scroll-mt-6">
                <GeneralSection />
              </div>
            </>
          ) : null}
          {show("appearance") ? (
            <>
              <SectionDivider />
              <div id="settings-section-appearance" className="scroll-mt-6">
                <AppearanceSection />
              </div>
            </>
          ) : null}
          {show("models") ? (
            <>
              <SectionDivider />
              <div id="settings-section-models" className="scroll-mt-6">
                <ModelsSection />
              </div>
            </>
          ) : null}
          {show("agents") ? (
            <>
              <SectionDivider />
              <div id="settings-section-agents" className="scroll-mt-6">
                <AgentsSection />
              </div>
            </>
          ) : null}
          {show("mcp") ? (
            <>
              <SectionDivider />
              <div id="settings-section-mcp" className="scroll-mt-6">
                <McpSection />
              </div>
            </>
          ) : null}
          {show("tools") ? (
            <>
              <SectionDivider />
              <div id="settings-section-tools" className="scroll-mt-6">
                <ToolsSection />
              </div>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function SectionDivider() {
  return (
    <div className="my-10 flex items-center gap-4">
      <div className="h-[2px] flex-1 rounded-full bg-primary/20" />
      <div className="size-1 rotate-45 bg-primary/30" />
      <div className="h-[2px] flex-1 rounded-full bg-primary/20" />
    </div>
  );
}



function AgentsSection() {
  const agents = useAgents();
  const [editing, setEditing] = useState<Agent | null>(null);

  const save = () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name || !editing.systemPrompt.trim()) return;
    upsertAgent({
      id: editing.id,
      name,
      systemPrompt: editing.systemPrompt.trim(),
      model: editing.model?.trim() || undefined,
    });
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader title="Agents" description="Named assistant personas for the AI panel." />
      <div className="flex flex-col gap-2">
        {agents.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between gap-4 rounded border border-border/40 bg-muted/20 px-3 py-2.5"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[12.5px] font-medium text-foreground">{a.name}</span>
              <span className="text-[10.5px] text-muted-foreground">
                {a.builtIn ? "Built-in preset" : "Custom"}
              </span>
            </div>
            {a.builtIn ? (
              <span className="rounded-full border border-border/40 bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                preset
              </span>
            ) : (
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="xs" onClick={() => setEditing(a)}>
                  Edit
                </Button>
                <Button variant="ghost" size="xs" onClick={() => removeAgent(a.id)}>
                  Delete
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2 rounded border border-border/40 bg-muted/20 p-3">
          <Input
            placeholder="Agent name"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            className="h-8 bg-background text-[12px]"
          />
          <Input
            placeholder="Model id override (optional)"
            value={editing.model ?? ""}
            onChange={(e) => setEditing({ ...editing, model: e.target.value })}
            className="h-8 bg-background text-[12px]"
          />
          <Textarea
            placeholder="System prompt"
            rows={5}
            value={editing.systemPrompt}
            onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
            className="bg-background text-[12px]"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setEditing({ id: newAgentId(), name: "", systemPrompt: "", model: "" })}
        >
          + New agent
        </Button>
      )}
    </div>
  );
}
