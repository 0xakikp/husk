import { useState } from "react";
import {
  addPortForward,
  updatePortForward,
  deletePortForward,
  getPortForwards,
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

interface PortForwardDialogProps {
  connectionId: string;
  onClose: () => void;
}

export function PortForwardDialog({
  connectionId,
  onClose,
}: PortForwardDialogProps) {
  const [forwards, setForwards] = useState<PortForward[]>(
    getPortForwards(connectionId)
  );
  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState<"local" | "remote" | "dynamic">("local");
  const [localPort, setLocalPort] = useState("");
  const [remoteHost, setRemoteHost] = useState("");
  const [remotePort, setRemotePort] = useState("");

  const handleAdd = () => {
    const lPort = parseInt(localPort, 10);
    if (isNaN(lPort) || lPort < 1 || lPort > 65535) return;

    const rPort = remotePort ? parseInt(remotePort, 10) : undefined;
    if (rPort !== undefined && (isNaN(rPort) || rPort < 1 || rPort > 65535))
      return;

    const newPf = addPortForward({
      connectionId,
      type,
      localPort: lPort,
      remoteHost: remoteHost || undefined,
      remotePort: rPort,
      active: false,
    });

    setForwards([...forwards, newPf]);
    setShowAdd(false);
    setLocalPort("");
    setRemoteHost("");
    setRemotePort("");
  };

  const toggleForward = (id: string) => {
    const pf = forwards.find((f) => f.id === id);
    if (!pf) return;

    // TODO: Start/stop actual tunnel via Rust
    const updated = updatePortForward(id, { active: !pf.active });
    if (updated) {
      setForwards(forwards.map((f) => (f.id === id ? updated : f)));
    }
  };

  const removeForward = (id: string) => {
    deletePortForward(id);
    setForwards(forwards.filter((f) => f.id !== id));
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
              <Switch
                checked={pf.active}
                onCheckedChange={() => toggleForward(pf.id)}
              />
              <button
                onClick={() => removeForward(pf.id)}
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
