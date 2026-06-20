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
import { ToolsSection } from "./ToolsSection";
import { CloudSyncSection } from "./CloudSyncSection";

type SectionId = "about" | "general" | "appearance" | "models" | "mcp" | "tools" | "cloudSync";

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
    id: "mcp",
    label: "MCP",
    keywords: ["mcp", "server", "tool", "context", "protocol", "external"],
  },
  {
    id: "tools",
    label: "Tools",
    keywords: ["tool", "cli", "install", "recommended"],
  },
  {
    id: "cloudSync",
    label: "Cloud Sync",
    keywords: ["sync", "backup", "export", "import", "transfer", "device"],
  },
];

function scrollToSection(id: SectionId) {
  const elId = id === "cloudSync" ? "cloud-sync" : `settings-section-${id}`;
  document.getElementById(elId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState<SectionId>("about");
  const mainRef = useRef<HTMLElement>(null);

  // Track which section is currently in view.
  // getBoundingClientRect().top is measured in viewport coordinates, so
  // it always matches regardless of whether the scroll container is
  // relative, absolute, or fixed.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const updateActive = () => {
      const mainRect = main.getBoundingClientRect();
      const threshold = mainRect.top + 80; // 80 px below top of <main>
      let current: SectionId = "about";
      let lastVisible: SectionId | null = null;
      for (const s of SECTIONS) {
        const elId = s.id === "cloudSync" ? "cloud-sync" : `settings-section-${s.id}`;
        const el = document.getElementById(elId);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= threshold) {
          current = s.id;
        }
        // If element is visible in viewport (even partially), track it as last visible
        if (rect.bottom > mainRect.top && rect.top < mainRect.bottom) {
          lastVisible = s.id;
        }
      }
      // If we're near the bottom and last visible section is cloudSync, force it active
      const nearBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 100;
      if (nearBottom && lastVisible === "cloudSync") {
        current = "cloudSync";
      }
      setActiveSection(current);
    };

    main.addEventListener("scroll", updateActive, { passive: true });
    // Call immediately and again after the enter animation finishes
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
      (s) => s.label.toLowerCase().includes(q) || s.keywords.some((k) => k.includes(q)),
    );
  }, [search]);
  const show = (id: SectionId) => visible.some((s) => s.id === id);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground select-none">
      <div className="flex h-8 shrink-0 items-center gap-2 bg-background px-3">
        <div className="flex items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((s) => {
            const active = activeSection === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollToSection(s.id)}
                className={cn(
                  "relative h-6 rounded-md px-2.5 text-[11.5px] transition-colors shrink-0",
                  active
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
                {active && (
                  <span className="absolute bottom-0 left-1.5 right-1.5 h-[2px] rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative w-36">
            <HugeiconsIcon
              icon={Search01Icon}
              size={14}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Find…"
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

      <main
        ref={mainRef}
        className="min-h-0 flex-1 overflow-y-auto px-8 pt-6 pb-7 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
          <div className="mx-auto w-full max-w-160">
            {visible.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No settings match "{search}"
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
            {show("cloudSync") ? (
              <>
                <SectionDivider />
                <div id="cloud-sync" className="scroll-mt-6">
                  <CloudSyncSection />
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


