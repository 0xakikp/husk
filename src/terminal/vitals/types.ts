export type VitalKind = "duration" | "command" | "ssh" | "root" | "disk" | "memory" | "network";

export type Vital =
  | { kind: "duration"; elapsedMs: number }
  | { kind: "command"; name: string }
  | { kind: "ssh"; host: string }
  | { kind: "root" }
  | { kind: "disk"; percent: number }
  | { kind: "memory"; mb: number }
  | { kind: "network"; rttMs: number | null };
