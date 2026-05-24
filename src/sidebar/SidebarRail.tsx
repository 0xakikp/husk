import { cn } from "@/lib/utils";

const railBtn =
  "inline-flex items-center justify-center w-[30px] h-[30px] rounded-[7px] border-0 bg-transparent text-sm text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer";

export function SidebarRail({
  explorerOpen,
  onFiles,
  onSourceControl,
  onGitHistory,
  onSearch,
}: {
  explorerOpen: boolean;
  onFiles: () => void;
  onSourceControl: () => void;
  onGitHistory: () => void;
  onSearch: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1 shrink-0 w-10 py-1.5 bg-sidebar border-r border-border">
      <button
        type="button"
        className={cn(railBtn, explorerOpen && "bg-muted text-foreground")}
        title="Files"
        onClick={onFiles}
      >
        🗂
      </button>
      <button type="button" className={railBtn} title="Source control" onClick={onSourceControl}>
        ⑂
      </button>
      <button type="button" className={railBtn} title="Git history" onClick={onGitHistory}>
        🕘
      </button>
      <button type="button" className={railBtn} title="Command palette" onClick={onSearch}>
        ⌘
      </button>
    </div>
  );
}
