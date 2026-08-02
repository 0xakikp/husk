import { useActiveTerminalCwd } from "../ai/terminalContext";
import { useWorkspaceRoot } from "../workspace/store";

function segmentPath(cwd: string, root: string): string[] {
  if (!cwd) return ["~"];

  if (root && cwd.startsWith(root)) {
    const rel = cwd.slice(root.length).replace(/^\//, "");
    if (!rel) return [root.split("/").filter(Boolean).pop() || root];
    const rootName = root.split("/").filter(Boolean).pop() || root;
    return [rootName, ...rel.split("/").filter(Boolean)];
  }

  if (cwd.startsWith("/Users/")) {
    const rel = cwd.slice("/Users/".length).replace(/^[^/]+\/?/, "");
    if (!rel) return ["~"];
    return ["~", ...rel.split("/").filter(Boolean)];
  }

  const parts = cwd.replace(/^\//, "").split("/").filter(Boolean);
  return parts.length ? parts : ["/"];
}

function segmentFile(path: string): string[] {
  const parts = path.replace(/^\//, "").split("/").filter(Boolean);
  return parts.length ? parts : ["/"];
}

export function PathBar({ activeFile }: { activeFile?: string | null }) {
  const cwd = useActiveTerminalCwd();
  const root = useWorkspaceRoot();

  const segments = activeFile ? segmentFile(activeFile) : segmentPath(cwd, root);

  return (
    <div className="flex h-5 shrink-0 items-center gap-0.5 px-3 text-[10px] text-muted-foreground select-none">
      {segments.map((seg, i) => (
        <span key={`${seg}-${i}`} className="flex items-center gap-0.5">
          {i > 0 && (
            <span className="text-muted-foreground/20 mx-0.5 text-[10px]">/</span>
          )}
          <span className="inline-flex items-center rounded bg-muted/20 px-1.5 py-0 text-[10px] font-medium text-violet-400/90">
            {seg}
          </span>
        </span>
      ))}
    </div>
  );
}
