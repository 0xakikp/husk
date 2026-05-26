import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Add01Icon,
  ArtificialIntelligence04Icon,
  BrowserIcon,
  ChartHistogramIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CloudServerIcon,
  CreditCardPosIcon,
  Database01Icon,
  Database02Icon,
  FlowConnectionIcon,
  Flowchart01Icon,
  Folder01Icon,
  GitCommitIcon,
  GithubIcon,
  GlobeIcon,
  Link01Icon,
  Location01Icon,
  Search01Icon,
  SlackIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import {
  getMarketplaceCategories,
  getRequiredEnvVars,
  hasRequiredEnvVars,
  type McpMarketplaceItem,
  searchMarketplace,
} from "./marketplace";

// ── Icon mapping from marketplace string IDs to HugeiconsIcon components ──
const ICON_MAP: Record<
  string,
  React.FC<{ size?: number; className?: string }>
> = {
  Folder01Icon: (props) => <HugeiconsIcon icon={Folder01Icon} {...props} />,
  BrowserIcon: (props) => <HugeiconsIcon icon={BrowserIcon} {...props} />,
  GlobeIcon: (props) => <HugeiconsIcon icon={GlobeIcon} {...props} />,
  GitCommitIcon: (props) => <HugeiconsIcon icon={GitCommitIcon} {...props} />,
  BrainIcon: (props) => (
    <HugeiconsIcon icon={ArtificialIntelligence04Icon} {...props} />
  ),
  CloudServerIcon: (props) => (
    <HugeiconsIcon icon={CloudServerIcon} {...props} />
  ),
  Location01Icon: (props) => (
    <HugeiconsIcon icon={Location01Icon} {...props} />
  ),
  Database01Icon: (props) => (
    <HugeiconsIcon icon={Database01Icon} {...props} />
  ),
  Database02Icon: (props) => (
    <HugeiconsIcon icon={Database02Icon} {...props} />
  ),
  ArtificialIntelligence04Icon: (props) => (
    <HugeiconsIcon icon={ArtificialIntelligence04Icon} {...props} />
  ),
  SlackIcon: (props) => <HugeiconsIcon icon={SlackIcon} {...props} />,
  Flowchart01Icon: (props) => (
    <HugeiconsIcon icon={Flowchart01Icon} {...props} />
  ),
  Search01Icon: (props) => <HugeiconsIcon icon={Search01Icon} {...props} />,
  ChartHistogramIcon: (props) => (
    <HugeiconsIcon icon={ChartHistogramIcon} {...props} />
  ),
  CreditCardPosIcon: (props) => (
    <HugeiconsIcon icon={CreditCardPosIcon} {...props} />
  ),
  FlowConnectionIcon: (props) => (
    <HugeiconsIcon icon={FlowConnectionIcon} {...props} />
  ),
  Clock01Icon: (props) => <HugeiconsIcon icon={Clock01Icon} {...props} />,
  GithubIcon: (props) => <HugeiconsIcon icon={GithubIcon} {...props} />,
};

function MarketplaceIcon({
  name,
  size = 20,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const Icon = ICON_MAP[name];
  if (!Icon) {
    return (
      <HugeiconsIcon icon={CloudServerIcon} size={size} className={className} />
    );
  }
  return <Icon size={size} className={className} />;
}

// ── Category badge colors ─────────────────────────────────────────────────
const CATEGORY_STYLES: Record<
  McpMarketplaceItem["category"],
  { bg: string; text: string; border: string }
> = {
  Development: {
    bg: "bg-blue-500/10",
    text: "text-blue-500",
    border: "border-blue-500/20",
  },
  Cloud: {
    bg: "bg-sky-500/10",
    text: "text-sky-500",
    border: "border-sky-500/20",
  },
  Database: {
    bg: "bg-emerald-500/10",
    text: "text-emerald-500",
    border: "border-emerald-500/20",
  },
  "AI & ML": {
    bg: "bg-violet-500/10",
    text: "text-violet-500",
    border: "border-violet-500/20",
  },
  Communication: {
    bg: "bg-amber-500/10",
    text: "text-amber-500",
    border: "border-amber-500/20",
  },
  Search: {
    bg: "bg-rose-500/10",
    text: "text-rose-500",
    border: "border-rose-500/20",
  },
  Monitoring: {
    bg: "bg-orange-500/10",
    text: "text-orange-500",
    border: "border-orange-500/20",
  },
  Payments: {
    bg: "bg-green-500/10",
    text: "text-green-500",
    border: "border-green-500/20",
  },
  Automation: {
    bg: "bg-cyan-500/10",
    text: "text-cyan-500",
    border: "border-cyan-500/20",
  },
  Utilities: {
    bg: "bg-slate-500/10",
    text: "text-slate-500",
    border: "border-slate-500/20",
  },
};

// ── Props ──────────────────────────────────────────────────────────────────
type McpMarketplaceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installedIds: string[];
  onInstall: (
    item: McpMarketplaceItem,
    envOverrides: Record<string, string>,
  ) => void;
  onUninstall: (id: string) => void;
};

export function McpMarketplaceDialog({
  open,
  onOpenChange,
  installedIds,
  onInstall,
  onUninstall,
}: McpMarketplaceDialogProps) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<
    McpMarketplaceItem["category"] | "All"
  >("All");
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [configuringItem, setConfiguringItem] =
    useState<McpMarketplaceItem | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});

  const categories = useMemo(() => ["All", ...getMarketplaceCategories()], []);

  const items = useMemo(
    () =>
      searchMarketplace(
        query,
        activeCategory === "All" ? undefined : activeCategory,
      ),
    [query, activeCategory],
  );

  const handleInstallClick = (item: McpMarketplaceItem) => {
    if (hasRequiredEnvVars(item)) {
      setConfiguringItem(item);
      setEnvValues(
        Object.fromEntries(
          Object.entries(item.env).map(([k, v]) => [k, v]),
        ),
      );
    } else {
      doInstall(item, {});
    }
  };

  const doInstall = (
    item: McpMarketplaceItem,
    envOverrides: Record<string, string>,
  ) => {
    setInstallingId(item.id);
    onInstall(item, envOverrides);
    setTimeout(() => setInstallingId(null), 500);
  };

  const handleConfigSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!configuringItem) return;
    doInstall(configuringItem, envValues);
    setConfiguringItem(null);
    setEnvValues({});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[720px] w-[90vw] max-w-[900px] flex-col overflow-hidden p-0 sm:max-w-[900px]">
        <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm">MCP Marketplace</DialogTitle>
            <span className="text-[11px] text-muted-foreground">
              {items.length} server{items.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search servers…"
              className="h-8 text-[12px]"
            />
            <div className="flex flex-wrap gap-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() =>
                    setActiveCategory(cat as typeof activeCategory)
                  }
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                    activeCategory === cat
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <HugeiconsIcon
                icon={Search01Icon}
                size={32}
                className="opacity-40"
              />
              <p className="text-[13px]">No servers match your search</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {items.map((item) => {
                const isInstalled = installedIds.includes(item.id);
                const isInstalling = installingId === item.id;
                const style = CATEGORY_STYLES[item.category];

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "group relative flex flex-col gap-2.5 rounded-xl border bg-card/40 p-4 transition-all",
                      "hover:border-primary/30 hover:bg-card/60",
                      isInstalled && "border-primary/20 bg-primary/5",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg border",
                          style.bg,
                          style.border,
                        )}
                      >
                        <MarketplaceIcon
                          name={item.icon}
                          size={18}
                          className={style.text}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-semibold text-foreground">
                            {item.name}
                          </span>
                          {item.verified && (
                            <HugeiconsIcon
                              icon={CheckmarkCircle02Icon}
                              size={13}
                              className="shrink-0 text-emerald-500"
                            />
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {item.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-muted-foreground/70">
                        {item.publisher}
                      </span>
                      <div className="flex gap-1.5">
                        {item.homepage && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            onClick={() =>
                              window.open(item.homepage, "_blank")
                            }
                            title="View docs"
                          >
                            <HugeiconsIcon icon={Link01Icon} size={12} />
                          </Button>
                        )}
                        {isInstalled ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 gap-1 text-[11px]"
                            onClick={() => onUninstall(item.id)}
                          >
                            <HugeiconsIcon
                              icon={CheckmarkCircle02Icon}
                              size={12}
                            />
                            Installed
                          </Button>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            className="h-6 gap-1 text-[11px]"
                            disabled={isInstalling}
                            onClick={() => handleInstallClick(item)}
                          >
                            {isInstalling ? (
                              <span className="inline-block size-3 animate-spin rounded-full border-2 border-background/30 border-t-background" />
                            ) : (
                              <HugeiconsIcon icon={Add01Icon} size={12} />
                            )}
                            Install
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>

      {/* Env config dialog for items that need credentials */}
      {configuringItem && (
        <Dialog open onOpenChange={() => setConfiguringItem(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">
                Configure {configuringItem.name}
              </DialogTitle>
            </DialogHeader>
            <form
              onSubmit={handleConfigSubmit}
              className="flex flex-col gap-3"
            >
              <p className="text-[11px] text-muted-foreground">
                {configuringItem.longDescription}
              </p>
              {getRequiredEnvVars(configuringItem).map(({ key, value }) => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {key}
                  </label>
                  <Input
                    value={envValues[key] ?? value}
                    onChange={(e) =>
                      setEnvValues((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                    placeholder={`Enter ${key}`}
                    className="h-8 text-[12px]"
                  />
                </div>
              ))}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => setConfiguringItem(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" className="h-7 text-[11px]">
                  Install
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}
