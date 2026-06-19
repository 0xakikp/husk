import { useState, useEffect } from "react";

const LS_KEY = "huskv2.ssh.connections";

export interface SshConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authType: "password" | "key" | "agent";
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  jumpHost?: string;
  tags: string[];
  lastConnected?: number;
  connectCount: number;
  color?: string;
}

export interface PortForward {
  id: string;
  connectionId: string;
  type: "local" | "remote" | "dynamic";
  localPort: number;
  remoteHost?: string;
  remotePort?: number;
  active: boolean;
}

let connections: SshConnection[] = [];
let portForwards: PortForward[] = [];

try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    connections = parsed.connections || [];
    portForwards = parsed.portForwards || [];
  }
} catch {
  connections = [];
  portForwards = [];
}

const subscribers = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ connections, portForwards }));
  } catch {
    // ignore
  }
  for (const fn of subscribers) fn();
}

export function getConnections(): SshConnection[] {
  return [...connections];
}

export function addConnection(conn: Omit<SshConnection, "id" | "connectCount">): SshConnection {
  const newConn: SshConnection = {
    ...conn,
    id: crypto.randomUUID(),
    connectCount: 0,
  };
  connections.push(newConn);
  save();
  return newConn;
}

export function updateConnection(id: string, updates: Partial<SshConnection>): SshConnection | null {
  const idx = connections.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  connections[idx] = { ...connections[idx], ...updates };
  save();
  return connections[idx];
}

export function deleteConnection(id: string): boolean {
  const idx = connections.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  connections.splice(idx, 1);
  // Remove associated port forwards
  portForwards = portForwards.filter((pf) => pf.connectionId !== id);
  save();
  return true;
}

export function recordConnection(id: string): void {
  const conn = connections.find((c) => c.id === id);
  if (!conn) return;
  conn.lastConnected = Date.now();
  conn.connectCount++;
  // Move to top of list
  connections = [conn, ...connections.filter((c) => c.id !== id)];
  save();
}

export function getPortForwards(connectionId?: string): PortForward[] {
  if (connectionId) {
    return portForwards.filter((pf) => pf.connectionId === connectionId);
  }
  return [...portForwards];
}

export function addPortForward(pf: Omit<PortForward, "id">): PortForward {
  const newPf: PortForward = { ...pf, id: crypto.randomUUID() };
  portForwards.push(newPf);
  save();
  return newPf;
}

export function updatePortForward(id: string, updates: Partial<PortForward>): PortForward | null {
  const idx = portForwards.findIndex((pf) => pf.id === id);
  if (idx === -1) return null;
  portForwards[idx] = { ...portForwards[idx], ...updates };
  save();
  return portForwards[idx];
}

export function deletePortForward(id: string): boolean {
  const idx = portForwards.findIndex((pf) => pf.id === id);
  if (idx === -1) return false;
  portForwards.splice(idx, 1);
  save();
  return true;
}

export function useConnections(): SshConnection[] {
  const [snapshot, setSnapshot] = useState<SshConnection[]>(() => [...connections]);
  useEffect(() => {
    const fn = () => setSnapshot([...connections]);
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);
  return snapshot;
}

export function usePortForwards(connectionId?: string): PortForward[] {
  const [snapshot, setSnapshot] = useState<PortForward[]>(() => getPortForwards(connectionId));
  useEffect(() => {
    const fn = () => setSnapshot(getPortForwards(connectionId));
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, [connectionId]);
  return snapshot;
}

export function getConnectionById(id: string): SshConnection | undefined {
  return connections.find((c) => c.id === id);
}

export function getConnectionByHost(host: string): SshConnection | undefined {
  return connections.find((c) => c.host === host);
}

export function getRecentConnections(limit = 5): SshConnection[] {
  return connections
    .filter((c) => c.lastConnected)
    .sort((a, b) => (b.lastConnected || 0) - (a.lastConnected || 0))
    .slice(0, limit);
}

export function getTaggedConnections(tag: string): SshConnection[] {
  return connections.filter((c) => c.tags.includes(tag));
}

export function getAllTags(): string[] {
  const tags = new Set<string>();
  for (const c of connections) {
    for (const t of c.tags) tags.add(t);
  }
  return Array.from(tags).sort();
}
