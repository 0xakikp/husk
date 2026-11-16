import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  addPortForward,
  updatePortForward,
  deletePortForward,
  getPortForwards,
  getConnectionById,
  type PortForward,
} from "../remote/connectionManager";
import { Modal } from "../components/Modal";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete01Icon } from "@hugeicons/core-free-icons";
import { toast } from "../toast";

interface PortForwardDialogProps {
  connectionId: string;
  onClose: () => void;
}

type NativeForwardStatus = { id: string; active: boolean; error: string | null };

/** A saved tunnel is only a configuration. Its running state belongs to the
 * current native process, not to localStorage from a previous app session. */
export function reconcileForwardActivity(
  saved: PortForward[],
  statuses: NativeForwardStatus[],
  pending: ReadonlySet<string> = new Set(),
): PortForward[] {
  const running = new Set(statuses.filter((status) => status.active).map((status) => status.id));
  return saved.map((forward) => pending.has(forward.id)
    ? forward
    : { ...forward, active: running.has(forward.id) });
}

export function PortForwardDialog({
  connectionId,
  onClose,
}: PortForwardDialogProps) {
  const [forwards, setForwards] = useState<PortForward[]>(
    getPortForwards(connectionId)
  );
  const [checking, setChecking] = useState(true);
  const [statusError, setStatusError] = useState(false);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const generationRef = useRef(0);
  const pollingGenerationRef = useRef<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState<"local" | "remote" | "dynamic">("local");
  const [localPort, setLocalPort] = useState("");
  const [remoteHost, setRemoteHost] = useState("");
  const [remotePort, setRemotePort] = useState("");

  const refreshRunning = useCallback(async () => {
    const generation = generationRef.current;
    if (pollingGenerationRef.current === generation) return;
    pollingGenerationRef.current = generation;
    try {
      const statuses = await invoke<NativeForwardStatus[]>("port_forward_list");
      if (generation !== generationRef.current) return;
      const saved = getPortForwards(connectionId);
      const reconciled = reconcileForwardActivity(saved, statuses, pendingRef.current);
      for (const forward of reconciled) {
        const previous = saved.find((candidate) => candidate.id === forward.id);
        if (previous && previous.active !== forward.active) {
          updatePortForward(forward.id, { active: forward.active });
        }
      }
      setForwards((current) => {
        const next = getPortForwards(connectionId);
        return current.length === next.length && current.every((forward, index) =>
          forward.id === next[index].id && forward.active === next[index].active
        ) ? current : next;
      });
      setStatusError(false);
    } catch {
      // Do not present a stale saved switch as confirmed running state.
      if (generation === generationRef.current) setStatusError(true);
    } finally {
      if (pollingGenerationRef.current === generation) pollingGenerationRef.current = null;
      if (generation === generationRef.current) setChecking(false);
    }
  }, [connectionId]);

  useEffect(() => {
    generationRef.current += 1;
    setChecking(true);
    void refreshRunning();
    const timer = window.setInterval(() => void refreshRunning(), 3_000);
    const onFocus = () => void refreshRunning();
    window.addEventListener("focus", onFocus);
    return () => {
      generationRef.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshRunning]);

  const setPending = (id: string, value: boolean) => {
    if (value) pendingRef.current.add(id);
    else pendingRef.current.delete(id);
    setPendingIds(new Set(pendingRef.current));
  };

  const handleAdd = () => {
    const lPort = parseInt(localPort, 10);
    if (isNaN(lPort) || lPort < 1 || lPort > 65535) return;

    const rPort = remotePort ? parseInt(remotePort, 10) : undefined;
    if (rPort !== undefined && (isNaN(rPort) || rPort < 1 || rPort > 65535))
      return;

    addPortForward({
      connectionId,
      type,
      localPort: lPort,
      remoteHost: remoteHost || undefined,
      remotePort: rPort,
      active: false,
    });

    setForwards(getPortForwards(connectionId));
    setShowAdd(false);
    setLocalPort("");
    setRemoteHost("");
    setRemotePort("");
  };

  const toggleForward = async (id: string) => {
    if (checking || statusError || pendingRef.current.has(id)) return;
    const pf = getPortForwards(connectionId).find((f) => f.id === id);
    if (!pf) return;

    const conn = getConnectionById(connectionId);
    if (!conn) return;

    setPending(id, true);
    if (pf.active) {
      // Stop the tunnel
      try {
        await invoke("port_forward_stop", { id: pf.id });
        const updated = updatePortForward(id, { active: false });
        if (updated) {
          setForwards(getPortForwards(connectionId));
        }
      } catch (e) {
        toast({ title: "Failed to stop tunnel: " + String(e), variant: "error" });
      }
    } else {
      // Start the tunnel
      try {
        await invoke("port_forward_start", {
          config: {
            id: pf.id,
            connectionId: pf.connectionId,
            host: conn.host,
            port: conn.port,
            user: conn.user,
            authType: conn.authType,
            password: conn.password,
            privateKeyPath: conn.privateKeyPath,
            passphrase: conn.passphrase,
            forwardType: pf.type,
            localPort: pf.localPort,
            remoteHost: pf.remoteHost,
            remotePort: pf.remotePort,
          },
        });
        const updated = updatePortForward(id, { active: true });
        if (updated) {
          setForwards(getPortForwards(connectionId));
        }
        toast({ title: "Tunnel requested: " + getDescription(pf), variant: "success" });
      } catch (e) {
        toast({ title: "Failed to start tunnel: " + String(e), variant: "error" });
      }
    }
    setPending(id, false);
    void refreshRunning();
  };

  const removeForward = async (id: string) => {
    if (checking || statusError || pendingRef.current.has(id)) return;
    const forward = getPortForwards(connectionId).find((candidate) => candidate.id === id);
    if (!forward) return;
    setPending(id, true);
    if (forward.active) {
      try {
        await invoke("port_forward_stop", { id });
      } catch (error) {
        toast({ title: "Failed to stop tunnel: " + String(error), variant: "error" });
        setPending(id, false);
        void refreshRunning();
        return;
      }
    }
    deletePortForward(id);
    setForwards(getPortForwards(connectionId));
    setPending(id, false);
  };

  const getDescription = (pf: PortForward) => {
    switch (pf.type) {
      case "local":
        return `localhost:${pf.localPort} → ${pf.remoteHost}:${pf.remotePort}`;
      case "remote":
        return `${pf.remoteHost}:${pf.remotePort} ← localhost:${pf.localPort}`;
      case "dynamic":
        return `SOCKS5 proxy on localhost:${pf.localPort}`;
    }
  };

  return (
    <Modal title="Port Forwards" onClose={onClose} className="max-w-md">

      {checking && <p className="text-xs text-muted-foreground mb-3">Checking running tunnels…</p>}
      {statusError && <p role="alert" className="text-xs text-destructive mb-3">Could not verify running tunnels. Controls will be available when the connection recovers.</p>}

      {forwards.length === 0 && !showAdd && (
        <p className="text-muted-foreground text-sm text-center py-4">
          No port forwards configured
        </p>
      )}

      <div className="space-y-2 mb-4">
        {forwards.map((pf) => (
          <div
            key={pf.id}
            className="flex items-center justify-between p-2 rounded bg-accent/50"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {getDescription(pf)}
              </div>
              <div className="text-xs text-muted-foreground">
                {pf.type === "dynamic"
                  ? "Dynamic (SOCKS5)"
                  : pf.type === "local"
                    ? "Local forward"
                    : "Remote forward"}
              </div>
            </div>
            <div className="flex items-center gap-2 ml-2">
              {checking || statusError ? (
                <span className="text-xs text-muted-foreground">{checking ? "Checking…" : "Unknown"}</span>
              ) : (
                <Switch
                  checked={pf.active}
                  disabled={pendingIds.has(pf.id)}
                  aria-label={`${pf.active ? "Stop" : "Start"} ${getDescription(pf)}`}
                  onCheckedChange={() => toggleForward(pf.id)}
                />
              )}
              <button
                onClick={() => removeForward(pf.id)}
                disabled={checking || statusError || pendingIds.has(pf.id)}
                aria-label={`Remove ${getDescription(pf)}`}
                className="text-muted-foreground hover:text-red-500"
              >
                <HugeiconsIcon icon={Delete01Icon} size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAdd ? (
        <div className="space-y-3 p-3 rounded bg-accent/30">
          <div>
            <Label>Type</Label>
            <Select
              value={type}
              onValueChange={(v: "local" | "remote" | "dynamic") =>
                setType(v)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local (-L)</SelectItem>
                <SelectItem value="remote">Remote (-R)</SelectItem>
                <SelectItem value="dynamic">Dynamic/SOCKS5 (-D)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Local Port</Label>
            <Input
              type="number"
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              placeholder="8080"
              min={1}
              max={65535}
            />
          </div>

          {type !== "dynamic" && (
            <>
              <div>
                <Label>Remote Host</Label>
                <Input
                  value={remoteHost}
                  onChange={(e) => setRemoteHost(e.target.value)}
                  placeholder="localhost"
                />
              </div>
              <div>
                <Label>Remote Port</Label>
                <Input
                  type="number"
                  value={remotePort}
                  onChange={(e) => setRemotePort(e.target.value)}
                  placeholder="80"
                  min={1}
                  max={65535}
                />
              </div>
            </>
          )}

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleAdd}>
              Add Forward
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
          <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
          Add Forward
        </Button>
      )}
    </Modal>
  );
}
