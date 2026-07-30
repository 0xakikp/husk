import { useMemo, useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Search01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Input } from "@/components/ui/input";
import { GeneralSection } from "./GeneralSection";
import { AppearanceSection } from "./AppearanceSection";
import { AboutSection } from "./AboutSection";
import { ModelsSection } from "./ModelsSection";
import { McpSection } from "./McpSection";
import { SetupAssistantDialog, SetupAssistantBanner, ToolsSetupCard } from "./SetupAssistantDialog";
import { CloudSyncSection } from "./CloudSyncSection";
import { CrashReportingSection } from "./CrashReportingSection";

import { PromptTemplatesSection } from "./PromptTemplatesSection";
import { AiAgentsSection } from "./AiAgentsSection";

type SectionId =
  | "about"
  | "general"
  | "appearance"
  | "models"
  | "ai"
  | "mcp"
  | "tools"
  | "cloudSync"
  | "crash";

type SectionGroup = "husk.config" | "ai" | "mcp" | "other" | "manifest";

type SectionDef = {
  id: SectionId;
  label: string;
  /** File-like label shown in the config tree sidebar. */
  treeLabel: string;
  group: SectionGroup;
  keywords: string[];
};

const SECTIONS: SectionDef[] = [
  { id: "about", label: "Manifest", treeLabel: "manifest", group: "manifest", keywords: ["about", "version", "build", "license"] },
  {
    id: "general",
    label: "General",
    treeLabel: "general",
    group: "husk.config",
    keywords: ["terminal", "font", "size", "cursor", "blink", "theme"],
  },
  {
    id: "appearance",
    label: "Appearance",
    treeLabel: "appearance",
    group: "husk.config",
    keywords: ["background", "image", "wallpaper", "opacity", "blur", "transparency", "dim"],
  },
  {
    id: "models",
    label: "Models",
    treeLabel: "models",
    group: "ai",
    keywords: ["model", "provider", "api", "key", "ai", "anthropic", "openai", "local"],
  },
  {
    id: "ai",
    label: "AI Composer",
    treeLabel: "composer",
    group: "ai",
    keywords: ["agent", "persona", "system", "prompt", "template", "composer", "refactor", "explain", "tests", "debug", "script"],
  },
  {
    id: "mcp",
    label: "MCP",
    treeLabel: "servers",
    group: "mcp",
    keywords: ["mcp", "server", "tool", "context", "protocol", "external"],
  },
  {
    id: "tools",
    label: "Tools",
    treeLabel: "tools",
    group: "other",
    keywords: ["tool", "cli", "install", "recommended"],
  },
  {
    id: "cloudSync",
    label: "Cloud Sync",
    treeLabel: "cloud.sync",
    group: "other",
    keywords: ["sync", "backup", "export", "import", "transfer", "device"],
  },
  {
    id: "crash",
    label: "Crash Reporting",
    treeLabel: "crash",
    group: "other",
    keywords: ["crash", "sentry", "error", "report", "telemetry"],
  },
];

const GROUPS: { id: SectionGroup; label: string; indentItems?: boolean }[] = [
  { id: "husk.config", label: "husk.config" },
  { id: "ai", label: "ai/", indentItems: true },
  { id: "mcp", label: "mcp/", indentItems: true },
  { id: "other", label: "other" },
  { id: "manifest", label: "manifest" },
];

/** Map a section id to the DOM element id used to scroll to it. */
function sectionElementId(id: SectionId): string {
  if (id === "ai") return "ai";
  if (id === "cloudSync") return "cloud-sync";
  if (id === "crash") return "settings-section-crash";
  return `settings-section-${id}`;
}

function scrollToSection(id: SectionId) {
  document.getElementById(sectionElementId(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function SettingsSidebar({
  activeSection,
  search,
  setSearch,
  onSelect,
  visible,
}: {
  activeSection: SectionId;
  search: string;
  setSearch: (s: string) => void;
  onSelect: (id: SectionId) => void;
  visible: SectionDef[];
}) {
  const visibleIds = useMemo(() => new Set(visible.map((s) => s.id)), [visible]);

  return (
    <div className="flex w-56 shrink-0 flex-col border-r border-border bg-background">
      <div className="p-3">
        <div className="relative">
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
            className="h-7 rounded border-border/40 bg-muted/40 py-0 pl-8 pr-3 text-[11.5px]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 font-mono text-[11px]">
        {GROUPS.map((g) => {
          const groupSections = SECTIONS.filter((s) => s.group === g.id && visibleIds.has(s.id));
          if (groupSections.length === 0) return null;

          return (
            <div key={g.id} className="mb-4">
              <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-muted-foreground/50">
                {g.label}
              </div>
              <div className={cn("flex flex-col gap-0.5", g.indentItems && "ml-2.5 border-l border-border/50 pl-2.5")}>
                {groupSections.map((s) => {
                  const active = activeSection === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onSelect(s.id)}
                      className={cn(
                        "group relative flex w-full items-center rounded-md px-2 py-1 text-left transition-colors",
                        active
                          ? "bg-primary/[0.08] text-foreground"
                          : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute left-0 top-1/2 -translate-y-1/2 h-3.5 w-[2px] rounded-r-full transition-opacity",
                          active ? "bg-primary opacity-100" : "bg-primary/0 opacity-0",
                        )}
                      />
                      <span className="pl-2">{s.treeLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {visible.length === 0 ? (
          <div className="px-2 py-4 text-[10px] text-muted-foreground/60">
            No settings match “{search}”
          </div>
        ) : null}
      </div>

      <div className="border-t border-border px-3 py-2 font-mono text-[9px] text-muted-foreground/50">
        active: {SECTIONS.find((s) => s.id === activeSection)?.treeLabel ?? "…"}
      </div>
    </div>
  );
}

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState<SectionId>("about");
  const [setupOpen, setSetupOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // Track which section is currently in view.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const updateActive = () => {
      const mainRect = main.getBoundingClientRect();
      const threshold = mainRect.top + 80;
      let current: SectionId = "about";
      let lastVisible: SectionId | null = null;
      for (const s of SECTIONS) {
        const el = document.getElementById(sectionElementId(s.id));
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= threshold) {
          current = s.id;
        }
        if (rect.bottom > mainRect.top && rect.top < mainRect.bottom) {
          lastVisible = s.id;
        }
      }
      const nearBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 100;
      if (nearBottom && lastVisible === "crash") {
        current = "crash";
      }
      setActiveSection(current);
    };

    main.addEventListener("scroll", updateActive, { passive: true });
    updateActive();
    const t = setTimeout(updateActive, 400);
    return () => {
      main.removeEventListener("scroll", updateActive);
      clearTimeout(t);
    };
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.keywords.some((k) => k.includes(q)) || s.treeLabel.includes(q),
    );
  }, [search]);
  const show = (id: SectionId) => visible.some((s) => s.id === id);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground select-none">
      {/* Top bar: config path + close */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="font-mono text-[11px] text-muted-foreground">~/.husk/config</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <SettingsSidebar
          activeSection={activeSection}
          search={search}
          setSearch={setSearch}
          onSelect={scrollToSection}
          visible={visible}
        />

        <main
          ref={mainRef}
          className="min-h-0 flex-1 overflow-y-auto bg-background px-10 py-8 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="mx-auto w-full max-w-3xl space-y-12">
            {visible.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No settings match “{search}”
              </div>
            ) : null}

            {show("about") ? (
              <div id={sectionElementId("about")} className="scroll-mt-8">
                <AboutSection />
              </div>
            ) : null}

            {show("general") ? (
              <div id={sectionElementId("general")} className="scroll-mt-8">
                <GeneralSection />
              </div>
            ) : null}

            {show("appearance") ? (
              <div id={sectionElementId("appearance")} className="scroll-mt-8">
                <AppearanceSection />
              </div>
            ) : null}

            {show("models") ? (
              <div id={sectionElementId("models")} className="scroll-mt-8">
                <ModelsSection />
              </div>
            ) : null}

            {show("ai") ? (
              <div id={sectionElementId("ai")} className="scroll-mt-8 flex flex-col gap-6">
                <AiAgentsSection />
                <PromptTemplatesSection />
              </div>
            ) : null}

            {show("mcp") ? (
              <div id={sectionElementId("mcp")} className="scroll-mt-8">
                <McpSection />
              </div>
            ) : null}

            {show("tools") ? (
              <div id={sectionElementId("tools")} className="scroll-mt-8 space-y-4">
                <ToolsSetupCard onOpen={() => setSetupOpen(true)} />
                <SetupAssistantBanner onOpen={() => setSetupOpen(true)} />
                <SetupAssistantDialog open={setupOpen} onOpenChange={setSetupOpen} />
              </div>
            ) : null}

            {show("cloudSync") ? (
              <div id={sectionElementId("cloudSync")} className="scroll-mt-8">
                <CloudSyncSection />
              </div>
            ) : null}

            {show("crash") ? (
              <div id={sectionElementId("crash")} className="scroll-mt-8">
                <CrashReportingSection />
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
