import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  addConnection,
  updateConnection,
  deleteConnection,
  getConnectionById,
  type SshConnection,
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
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderOpenIcon,
  SaveIcon,
  Delete01Icon,
} from "@hugeicons/core-free-icons";

interface ConnectionDialogProps {
  connectionId?: string;
  onClose: () => void;
  onSave: (conn: SshConnection) => void;
}

export function ConnectionDialog({
  connectionId,
  onClose,
  onSave,
}: ConnectionDialogProps) {
  const existing = connectionId ? getConnectionById(connectionId) : undefined;

  const [name, setName] = useState(existing?.name || "");
  const [host, setHost] = useState(existing?.host || "");
  const [port, setPort] = useState(existing?.port?.toString() || "22");
  const [user, setUser] = useState(existing?.user || "");
  const [authType, setAuthType] = useState<
    "password" | "key" | "agent"
  >(existing?.authType || "agent");
  const [password, setPassword] = useState(existing?.password || "");
  const [privateKeyPath, setPrivateKeyPath] = useState(
    existing?.privateKeyPath || ""
  );
  const [passphrase, setPassphrase] = useState(existing?.passphrase || "");
  const [jumpHost, setJumpHost] = useState(existing?.jumpHost || "");
  const [tags, setTags] = useState(existing?.tags.join(", ") || "");
  const [color, setColor] = useState(existing?.color || "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pickKeyFile = async () => {
    try {
      const path = await invoke<string>("pick_file", {
        filters: [{ name: "SSH Key", extensions: ["", "pem", "key"] }],
      });
      if (path) setPrivateKeyPath(path);
    } catch {
      // user cancelled
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Name is required";
    if (!host.trim()) errs.host = "Host is required";
    if (!user.trim()) errs.user = "Username is required";
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      errs.port = "Port must be 1-65535";
    }
    if (authType === "key" && !privateKeyPath.trim()) {
      errs.key = "Private key path is required";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    const data = {
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port, 10),
      user: user.trim(),
      authType,
      password: password || undefined,
      privateKeyPath: privateKeyPath || undefined,
      passphrase: passphrase || undefined,
      jumpHost: jumpHost.trim() || undefined,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      color: color || undefined,
    };

    if (existing) {
      const updated = updateConnection(existing.id, data);
      if (updated) onSave(updated);
    } else {
      const created = addConnection(data);
      onSave(created);
    }
  };

  const handleDelete = () => {
    if (existing && confirm("Delete this connection?")) {
      deleteConnection(existing.id);
      onClose();
    }
  };

  const colors = [
    "",
    "#ef4444",
    "#f97316",
    "#f59e0b",
    "#84cc16",
    "#10b981",
    "#06b6d4",
    "#3b82f6",
    "#8b5cf6",
    "#d946ef",
    "#f43f5e",
  ];

  return (
    <Modal
      title={existing ? "Edit Connection" : "New SSH Connection"}
      onClose={onClose}
      className="max-w-lg border border-white/10 rounded-xl bg-[#0a0a0a]"
    >
      <div className="flex flex-col gap-5">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="conn-name" className="text-gray-300 text-sm font-medium">
            Name
          </Label>
          <Input
            id="conn-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Production Server"
            className={`bg-black/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all ${errors.name ? "border-red-500" : ""}`}
          />
          {errors.name && (
            <p className="text-xs text-red-500">{errors.name}</p>
          )}
        </div>

        {/* Host + Port */}
        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-3 flex flex-col gap-1.5">
            <Label htmlFor="conn-host" className="text-gray-300 text-sm font-medium">
              Host
            </Label>
            <Input
              id="conn-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.100 or server.com"
              className={`bg-black/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all ${errors.host ? "border-red-500" : ""}`}
            />
            {errors.host && (
              <p className="text-xs text-red-500">{errors.host}</p>
            )}
          </div>
          <div className="col-span-1 flex flex-col gap-1.5">
            <Label htmlFor="conn-port" className="text-gray-300 text-sm font-medium">
              Port
            </Label>
            <Input
              id="conn-port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className={`bg-black/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all ${errors.port ? "border-red-500" : ""}`}
            />
            {errors.port && (
              <p className="text-xs text-red-500">{errors.port}</p>
            )}
          </div>
        </div>

        {/* Username */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="conn-user" className="text-gray-300 text-sm font-medium">
            Username
          </Label>
          <Input
            id="conn-user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="root"
            className={`bg-black/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all ${errors.user ? "border-red-500" : ""}`}
          />
          {errors.user && (
            <p className="text-xs text-red-500">{errors.user}</p>
          )}
        </div>

        {/* Auth Type */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-gray-300 text-sm font-medium">Authentication</Label>
          <Select
            value={authType}
            onValueChange={(v: "password" | "key" | "agent") =>
              setAuthType(v)
            }
          >
            <SelectTrigger className="bg-black/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all h-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agent">SSH Agent</SelectItem>
              <SelectItem value="key">Private Key</SelectItem>
              <SelectItem value="password">Password</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Password */}
        {authType === "password" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="conn-password" className="text-gray-300 text-sm font-medium">
              Password
            </Label>
            <Input
              id="conn-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Optional - will prompt if empty"
              className="bg-black/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all"
            />
          </div>
        )}

        {/* Private Key */}
        {authType === "key" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="conn-key" className="text-gray-300 text-sm font-medium">
                Private Key
              </Label>
              <div className="flex gap-2">
                <Input
                  id="conn-key"
                  value={privateKeyPath}
                  onChange={(e) => setPrivateKeyPath(e.target.value)}
                  placeholder="~/.ssh/id_rsa"
                  className={`flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all ${errors.key ? "border-red-500" : ""}`}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={pickKeyFile}
                  className="bg-black/50 border border-white/10 hover:bg-white/10 hover:text-white"
                >
                  <HugeiconsIcon icon={FolderOpenIcon} size={16} />
                </Button>
              </div>
              {errors.key && (
                <p className="text-xs text-red-500">{errors.key}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="conn-passphrase" className="text-gray-300 text-sm font-medium">
                Key Passphrase (optional)
              </Label>
              <Input
                id="conn-passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="bg-black/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all"
              />
            </div>
          </>
        )}

        {/* Jump Host */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="conn-jump" className="text-gray-300 text-sm font-medium">
            Jump Host / Bastion (optional)
          </Label>
          <Input
            id="conn-jump"
            value={jumpHost}
            onChange={(e) => setJumpHost(e.target.value)}
            placeholder="bastion.example.com"
            className="bg-black/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all"
          />
        </div>

        {/* Tags */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="conn-tags" className="text-gray-300 text-sm font-medium">
            Tags (comma-separated)
          </Label>
          <Input
            id="conn-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="prod, aws, database"
            className="bg-black/50 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-transparent transition-all"
          />
        </div>

        {/* Color */}
        <div className="flex flex-col gap-2">
          <Label className="text-gray-300 text-sm font-medium">Color</Label>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 transition-all ${
                  color === c
                    ? "border-white scale-110 ring-2 ring-white/30"
                    : "border-transparent hover:border-white/50"
                }`}
                style={{ backgroundColor: c || "#374151" }}
                title={c || "No color"}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-between mt-6 pt-4 border-t border-white/10">
        {existing ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
          >
            <HugeiconsIcon icon={Delete01Icon} size={16} className="mr-1.5" />
            Delete
          </Button>
        ) : (
          <div />
        )}
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="bg-transparent border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-500 text-white border-0"
          >
            <HugeiconsIcon icon={SaveIcon} size={16} className="mr-1.5" />
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
