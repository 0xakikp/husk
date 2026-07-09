import { useState, useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CloudIcon,
  RefreshIcon,
  ArrowRight01Icon,
  Settings01Icon,
  ArrowLeft01Icon,
  BotIcon,
  ComputerIcon,
  UserIcon,
  Tag01Icon,
  GlobeIcon,
  Clock01Icon,
} from "@hugeicons/core-free-icons";
import { listDevices, generateSshCommand, type TailscaleDevice } from "./api";
import { TailscaleSettingsDialog } from "./TailscaleSettingsDialog";
import { cn } from "@/lib/utils";
import { toast } from "@/toast";

function DeviceRow({
  device,
  onSelect,
}: {
  device: TailscaleDevice;
  onSelect: (device: TailscaleDevice) => void;
}) {
  const osIcon =
    device.os.toLowerCase().includes("linux")
      ? "🐧"
      : device.os.toLowerCase().includes("darwin") || device.os.toLowerCase().includes("mac")
        ? "🍎"
        : device.os.toLowerCase().includes("windows")
          ? "🪟"
          : "💻";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-xs transition-colors",
        device.online
          ? "border-border/40 bg-card/30 hover:border-border/60 hover:bg-card/50 cursor-pointer"
          : "border-border/20 bg-card/20 opacity-50 cursor-pointer",
      )}
      onClick={() => onSelect(device)}
      title={device.online ? `Click to view device details` : "Device offline"}
    >
      <div className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md",
        device.online ? "bg-primary/10" : "bg-muted/20",
      )}>
        <span className="text-sm">{osIcon}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-medium text-foreground">{device.name}</span>
          {device.ssh_enabled && device.online && (
            <span className="rounded bg-primary/10 px-1.5 py-0 text-[9px] text-primary uppercase tracking-wide">
              SSH
            </span>
          )}
        </div>
        <span className="truncate text-[11px] text-muted-foreground">
          {device.ipv4}
          {device.tags.length > 0 && ` · ${device.tags.join(", ")}`}
        </span>
      </div>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        size={14}
        strokeWidth={1.5}
        className="shrink-0 text-muted-foreground"
      />
      <div
        className={cn(
          "size-2 shrink-0 rounded-full",
          device.online ? "bg-emerald-500" : "bg-muted-foreground/30",
        )}
      />
    </div>
  );
}

export function TailscaleView({
  inline,
  onConnect,
}: {
  inline?: boolean;
  onConnect?: (device: TailscaleDevice) => void;
}) {
  const [devices, setDevices] = useState<TailscaleDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<TailscaleDevice | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const devs = await listDevices();
      setDevices(devs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleConnect = async (device: TailscaleDevice) => {
    if (!device.ssh_enabled) {
      toast({ title: "SSH not enabled for this device", variant: "warning" });
      return;
    }
    const sshUser = device.user || "root";
    const result = await generateSshCommand({ device_ip: device.ipv4, user: sshUser });
    if (result.success) {
      onConnect?.(device);
    }
  };

  const filtered = devices.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.ipv4.includes(search) ||
      d.tags.some((t) => t.toLowerCase().includes(search.toLowerCase())),
  );

  const onlineCount = devices.filter((d) => d.online).length;

  return (
    <div className={cn("flex h-full flex-col", inline ? "p-2" : "p-4")}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <HugeiconsIcon icon={CloudIcon} size={16} strokeWidth={1.5} className="text-primary" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-primary">Tailscale</span>
            <span className="text-[10px] text-muted-foreground">
              {onlineCount}/{devices.length} devices online
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Refresh"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              size={14}
              strokeWidth={1.75}
              className={loading ? "animate-spin" : ""}
            />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Settings"
          >
            <HugeiconsIcon icon={Settings01Icon} size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {selectedDevice ? (
        <DeviceDetailPanel
          device={selectedDevice}
          onBack={() => setSelectedDevice(null)}
          onConnect={() => handleConnect(selectedDevice)}
        />
      ) : (
        <>
          {/* Search */}
          <div className="relative mb-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices…"
              className="h-7 w-full rounded-md border border-muted-foreground/25 bg-background py-0 px-2.5 text-xs text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-primary"
            />
          </div>

          {/* Device list */}
          <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {error ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <p className="text-xs text-destructive">{error}</p>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="text-xs text-primary hover:underline"
                >
                  Configure Tailscale →
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {devices.length === 0 ? "No devices found" : "No matching devices"}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {filtered.map((device) => (
                  <DeviceRow key={device.id} device={device} onSelect={setSelectedDevice} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {settingsOpen && (
        <TailscaleSettingsDialog onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

function DeviceDetailPanel({
  device,
  onBack,
  onConnect,
}: {
  device: TailscaleDevice;
  onBack: () => void;
  onConnect: () => void;
}) {
  const osIcon =
    device.os.toLowerCase().includes("linux")
      ? "🐧"
      : device.os.toLowerCase().includes("darwin") || device.os.toLowerCase().includes("mac")
        ? "🍎"
        : device.os.toLowerCase().includes("windows")
          ? "🪟"
          : "💻";

  const rows = [
    { label: "Name", value: device.name, icon: ComputerIcon },
    { label: "IPv4", value: device.ipv4, icon: GlobeIcon },
    { label: "IPv6", value: device.ipv6 || "-", icon: GlobeIcon },
    { label: "OS", value: device.os, icon: ComputerIcon },
    { label: "User", value: device.user || "-", icon: UserIcon },
    { label: "Last seen", value: device.last_seen || "-", icon: Clock01Icon },
    { label: "Tags", value: device.tags.length ? device.tags.join(", ") : "-", icon: Tag01Icon },
  ];

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Back"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            device.online ? "bg-primary/10" : "bg-muted/20",
          )}>
            <span className="text-sm">{osIcon}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold text-foreground">{device.name}</div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className={cn(
                "size-1.5 rounded-full",
                device.online ? "bg-emerald-500" : "bg-muted-foreground/30",
              )} />
              {device.online ? "Online" : "Offline"}
              {device.ssh_enabled && (
                <span className="rounded bg-primary/10 px-1 text-[9px] text-primary uppercase">SSH</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onConnect}
        disabled={!device.online || !device.ssh_enabled}
        className="flex items-center justify-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <HugeiconsIcon icon={BotIcon} size={13} strokeWidth={1.75} />
        Connect via SSH
      </button>

      {!device.ssh_enabled && (
        <p className="text-[10px] text-muted-foreground">
          SSH is not enabled for this device. Enable it in the Tailscale admin console.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5"
          >
            <HugeiconsIcon icon={r.icon} size={12} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] text-muted-foreground">{r.label}</div>
              <div className="truncate text-[11px] font-medium text-foreground">{r.value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
