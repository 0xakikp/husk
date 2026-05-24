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
    <div className="rail">
      <button
        type="button"
        className={`rail-btn${explorerOpen ? " active" : ""}`}
        title="Files"
        onClick={onFiles}
      >
        🗂
      </button>
      <button type="button" className="rail-btn" title="Source control" onClick={onSourceControl}>
        ⑂
      </button>
      <button type="button" className="rail-btn" title="Git history" onClick={onGitHistory}>
        🕘
      </button>
      <button type="button" className="rail-btn" title="Command palette" onClick={onSearch}>
        ⌘
      </button>
    </div>
  );
}
