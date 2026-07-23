export type ActiveTab =
  | { kind: "term"; id: number }
  | { kind: "file"; path: string }
  | { kind: "settings" }
  | { kind: "git-graph" }
  | { kind: "issues" }
  | { kind: "ai" };
