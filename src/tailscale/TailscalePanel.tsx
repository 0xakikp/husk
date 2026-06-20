import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CloudIcon,
  RefreshIcon,
  ArrowRight01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { listDevices, type TailscaleDevice } from "./api";
import { cn } from "@/lib/utils";

function DeviceRow({
  device,
  onConnect,
}: {
  device: TailscaleDevice;
  onConnect: (device: TailscaleDevice) => void;
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
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
        device.online
          ? "hover:bg-accent/50 cursor-pointer"
          : "opacity-50 cursor-not-allowed",
      )}
      onClick={() => device.online && onConnect(device)}
      title={device.online ? `Click to SSH via Tailscale` : "Device offline"}
    >
      <span className="text-sm">{osIcon}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{device.name}</span>
        <span className="truncate text-[10px] text-muted-foreground">
          {device.ipv4}
          {device.tags.length > 0 && ` · ${device.tags.join(", ")}`}
        </span>
      </div>
      {device.ssh_enabled && device.online && (
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={12}
          strokeWidth={2}
          className="shrink-0 text-muted-foreground"
        />
      )}
      <div
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          device.online ? "bg-emerald-500" : "bg-muted-foreground/30",
        )}
      />
    </div>
  );
}

export function TailscalePanel({
  onConnect,
  onOpenSettings,
}: {
  onConnect: (device: TailscaleDevice) => void;
  onOpenSettings: () => void;
}) {
  const [devices, setDevices] = useState<TailscaleDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

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

  const filtered = devices.filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.ipv4.includes(search) ||
      d.tags.some((t) => t.toLowerCase().includes(search.toLowerCase())),
  );

  const onlineCount = devices.filter((d) => d.online).length;

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <HugeiconsIcon icon={CloudIcon} size={14} strokeWidth={1.75} className="text-primary" />
          <span className="text-xs font-medium">Tailscale</span>
          <span className="text-[10px] text-muted-foreground">
            ({onlineCount}/{devices.length})
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Refresh"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              size={12}
              strokeWidth={1.75}
              className={loading ? "animate-spin" : ""}
            />
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Settings"
          >
            <HugeiconsIcon icon={Settings01Icon} size={12} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search devices…"
          className="h-6 w-full rounded-md border border-muted-foreground/25 bg-background py-0 px-2 text-[11px] text-foreground placeholder:text-muted-foreground/70 outline-none focus:border-primary"
        />
      </div>

      {/* Device list */}
      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <p className="text-xs text-destructive">{error}</p>
            <button
              type="button"
              onClick={onOpenSettings}
              className="text-xs text-primary hover:underline"
            >
              Configure Tailscale →
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {devices.length === 0 ? "No devices found" : "No matching devices"}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filtered.map((device) => (
              <DeviceRow key={device.id} device={device} onConnect={onConnect} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
