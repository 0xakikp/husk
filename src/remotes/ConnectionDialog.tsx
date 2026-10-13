import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  addConnection,
  updateConnection,
  deleteConnection,
  getConnectionById,
  connectionInheritsSshConfig,
  type SshConnection,
} from "../remote/connectionManager";
import { Modal } from "../components/Modal";
import { CompactForm, CompactInput, CompactButton, CompactLabel, CompactSelectTrigger, CompactSelectContent, CompactSelectItem } from "../components/compact-form";
import { Select, SelectValue } from "../components/ui/select";
import { useSftpTargetPreview } from "./useSftpTargetPreview";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderOpenIcon,
  SaveIcon,
  Delete01Icon,
  ComputerTerminal02Icon,
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
  const [inheritSshConfig, setInheritSshConfig] = useState(() => existing ? connectionInheritsSshConfig(existing) : false);
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
  const { preview, error: previewError } = useSftpTargetPreview(inheritSshConfig && host.trim() ? { host: host.trim() } : null);

  const toggleSshConfig = (inherit: boolean) => {
    if (!inherit && preview) {
      setPort(String(preview.port));
      setUser(preview.username);
    }
    setInheritSshConfig(inherit);
    setErrors({});
  };

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
    if (!inheritSshConfig && !user.trim()) errs.user = "Username is required";
    const portNum = parseInt(port, 10);
    if (!inheritSshConfig && (isNaN(portNum) || portNum < 1 || portNum > 65535)) {
      errs.port = "Port must be 1-65535";
    }
    if (!inheritSshConfig && authType === "key" && !privateKeyPath.trim()) {
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
      inheritSshConfig,
      port: inheritSshConfig ? 22 : parseInt(port, 10),
      user: inheritSshConfig ? "" : user.trim(),
      authType: inheritSshConfig ? "agent" as const : authType,
      password: inheritSshConfig ? undefined : password || undefined,
      privateKeyPath: inheritSshConfig ? undefined : privateKeyPath || undefined,
      passphrase: inheritSshConfig ? undefined : passphrase || undefined,
      jumpHost: inheritSshConfig ? undefined : jumpHost.trim() || undefined,
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

  const errorProps = (field: string) => ({
    "aria-invalid": !!errors[field],
    "aria-describedby": errors[field] ? "conn-" + field + "-error" : undefined,
  });
  const fieldError = (field: string) => errors[field] ? <p id={"conn-" + field + "-error"} className="compact-error" role="alert">{errors[field]}</p> : null;

  return (
    <Modal
      compact
      icon={ComputerTerminal02Icon}
      title={existing ? "Edit Connection" : "New SSH Connection"}
      onClose={onClose}
      className="max-w-lg"
    >
      <CompactForm>
        <div className="compact-field">
          <CompactLabel htmlFor="conn-name">Name</CompactLabel>
          <CompactInput id="conn-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Production Server" {...errorProps("name")} />
          {fieldError("name")}
        </div>

        <div className="compact-field">
          <label className="flex items-center gap-2 text-xs" htmlFor="conn-inherit-ssh-config">
            <input id="conn-inherit-ssh-config" type="checkbox" checked={inheritSshConfig} onChange={(event) => toggleSshConfig(event.target.checked)} />
            Use SSH config
          </label>
          <p className="compact-hint">Follow the host alias's port, username and authentication. Turn this off to enter manual settings.</p>
          {inheritSshConfig && preview && <p className="compact-hint break-all">SSH config: {preview.username}@{preview.hostname}:{preview.port}</p>}
          {inheritSshConfig && previewError && <p className="compact-hint" role="status">SSH config preview unavailable: {previewError}</p>}
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="compact-field min-w-0 flex-[1_1_180px]">
            <CompactLabel htmlFor="conn-host">Host</CompactLabel>
            <CompactInput id="conn-host" value={host} onChange={(event) => setHost(event.target.value)} placeholder="192.168.1.100 or server.com" {...errorProps("host")} />
            {fieldError("host")}
          </div>
          <div className={`compact-field ${inheritSshConfig ? "w-28" : "w-20"} shrink-0`}>
            <CompactLabel htmlFor="conn-port">Port</CompactLabel>
            <CompactInput id="conn-port" inputMode="numeric" value={inheritSshConfig ? preview ? String(preview.port) : "" : port} placeholder={inheritSshConfig ? "SSH config" : undefined} disabled={inheritSshConfig} onChange={(event) => setPort(event.target.value)} {...errorProps("port")} />
            {fieldError("port")}
          </div>
        </div>

        <div className="compact-field">
          <CompactLabel htmlFor="conn-user">Username</CompactLabel>
          <CompactInput id="conn-user" value={inheritSshConfig ? preview?.username || "" : user} disabled={inheritSshConfig} onChange={(event) => setUser(event.target.value)} placeholder={inheritSshConfig ? "SSH config" : "root"} autoComplete="username" {...errorProps("user")} />
          {fieldError("user")}
        </div>

        <div className="compact-field">
          <CompactLabel htmlFor="conn-auth">Authentication</CompactLabel>
          {inheritSshConfig ? <CompactInput id="conn-auth" value="SSH config" disabled /> : <Select value={authType} onValueChange={(value: "password" | "key" | "agent") => setAuthType(value)}>
            <CompactSelectTrigger id="conn-auth" aria-label="Authentication"><SelectValue /></CompactSelectTrigger>
            <CompactSelectContent>
              <CompactSelectItem value="agent">SSH Agent</CompactSelectItem>
              <CompactSelectItem value="key">Private Key</CompactSelectItem>
              <CompactSelectItem value="password">Password</CompactSelectItem>
            </CompactSelectContent>
          </Select>}
        </div>

        {!inheritSshConfig && authType === "password" && <div className="compact-field">
          <CompactLabel htmlFor="conn-password">Password</CompactLabel>
          <CompactInput id="conn-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Optional — will prompt if empty" autoComplete="current-password" />
        </div>}

        {!inheritSshConfig && authType === "key" && <>
          <div className="compact-field">
            <CompactLabel htmlFor="conn-key">Private Key</CompactLabel>
            <div className="flex items-center gap-1.5">
              <CompactInput id="conn-key" value={privateKeyPath} onChange={(event) => setPrivateKeyPath(event.target.value)} placeholder="~/.ssh/id_rsa" className="min-w-0 flex-1" {...errorProps("key")} />
              <CompactButton icon aria-label="Choose private key file" title="Choose private key file" onClick={pickKeyFile}><HugeiconsIcon icon={FolderOpenIcon} size={14} /></CompactButton>
            </div>
            {fieldError("key")}
          </div>
          <div className="compact-field">
            <CompactLabel htmlFor="conn-passphrase">Key Passphrase (optional)</CompactLabel>
            <CompactInput id="conn-passphrase" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="off" />
          </div>
        </>}

        <div className="compact-field">
          <CompactLabel htmlFor="conn-jump">Jump Host / Bastion (optional)</CompactLabel>
          <CompactInput id="conn-jump" value={inheritSshConfig ? "" : jumpHost} disabled={inheritSshConfig} onChange={(event) => setJumpHost(event.target.value)} placeholder={inheritSshConfig ? "SSH config" : "bastion.example.com"} />
        </div>

        <div className="compact-field">
          <CompactLabel htmlFor="conn-tags">Tags (comma-separated)</CompactLabel>
          <CompactInput id="conn-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="prod, aws, database" />
        </div>

        <div className="compact-field">
          <span id="conn-color-label" className="compact-label">Color</span>
          <div role="group" aria-labelledby="conn-color-label" className="flex flex-wrap gap-2">
            {colors.map((option) => <button
              key={option}
              type="button"
              onClick={() => setColor(option)}
              aria-label={option ? "Color " + option : "No color"}
              aria-pressed={color === option}
              className={"size-6 shrink-0 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary " + (color === option ? "border-foreground ring-1 ring-primary ring-offset-2 ring-offset-background" : "border-border hover:border-foreground")}
              style={{ backgroundColor: option || "var(--muted)" }}
              title={option || "No color"}
            />)}
          </div>
        </div>

        <div className="compact-actions flex-wrap">
          {existing && <CompactButton variant="danger" className="compact-action-start" onClick={handleDelete}><HugeiconsIcon icon={Delete01Icon} size={13} />Delete</CompactButton>}
          <div className="compact-actions-main"><CompactButton variant="ghost" onClick={onClose}>Cancel</CompactButton>
          <CompactButton variant="primary" onClick={handleSave}><HugeiconsIcon icon={SaveIcon} size={13} />Save</CompactButton></div>
        </div>
      </CompactForm>
    </Modal>
  );
}
