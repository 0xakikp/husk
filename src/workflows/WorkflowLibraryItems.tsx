import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlayIcon, Edit02Icon, Delete02Icon, Copy01Icon, RepeatIcon, PinIcon, PinOffIcon, File02Icon } from "@hugeicons/core-free-icons";
import { HuskContextMenu, HuskContextMenuContent, HuskContextMenuItem, HuskContextMenuSeparator, HuskContextMenuTrigger } from "../components/HuskContextMenu";
import type { Workflow } from "./store";
import type { LinkedScript, WorkflowLibrary } from "./library";
import { workflowRunKey, type WorkflowRunStatus } from "./runStatus";
import { workflowRunLabel } from "./WorkflowRunOutput";

type Item = { kind: "workflow"; value: Workflow } | { kind: "script"; value: LinkedScript };
type Props = {
  workflows: Workflow[]; library: WorkflowLibrary; query: string; active: boolean;
  runs: ReadonlyMap<string, WorkflowRunStatus>;
  onEdit: (wf: Workflow) => void; onDuplicate: (wf: Workflow) => void;
  onCopyCommands: (wf: Workflow) => void; onCopyJson: (wf: Workflow) => void;
  onExport: (wf: Workflow) => void; onDelete: (wf: Workflow) => void; onRun: (wf: Workflow) => void;
  onPin: (kind: Item["kind"], id: string, pinned: boolean) => void;
  onOpenScript?: (script: LinkedScript) => void; onRunScript: (script: LinkedScript) => void;
  onRemoveScript: (script: LinkedScript) => void; onViewOutput: (id: string, name: string) => void;
};

function relativeTime(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function WorkflowLibraryItems(props: Props) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!props.active || !props.runs.size) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [props.active, props.runs]);
  const needle = props.query.trim().toLocaleLowerCase();
  const items: Item[] = [
    ...props.workflows.map((value): Item => ({ kind: "workflow", value })),
    ...props.library.scripts.map((value): Item => ({ kind: "script", value })),
  ].filter((item) => !needle || (item.kind === "workflow"
    ? [item.value.name, item.value.description, ...item.value.steps].join("\n")
    : `${item.value.name}\n${item.value.path}`).toLocaleLowerCase().includes(needle));
  const isPinned = (item: Item) => (item.kind === "workflow" ? props.library.pinnedWorkflowIds : props.library.pinnedScriptIds).includes(item.value.id);
  const pinned = items.filter(isPinned);
  const workflows = items.filter((item) => item.kind === "workflow" && !isPinned(item));
  const scripts = items.filter((item) => item.kind === "script" && !isPinned(item));
  const groups = [{ name: "Pinned", items: pinned }, { name: "Workflows", items: workflows }, { name: "Scripts", items: scripts }];
  const showHeadings = props.library.scripts.length > 0 || props.library.pinnedWorkflowIds.some((id) => props.workflows.some((wf) => wf.id === id));

  const renderItem = (item: Item) => {
    const { value, kind } = item;
    const pinnedItem = isPinned(item);
    const runKey = workflowRunKey(value.id, kind);
    const run = props.runs.get(runKey);
    const pinLabel = `${pinnedItem ? "Unpin" : "Pin"} ${value.name}`;
    const pin = () => props.onPin(kind, value.id, !pinnedItem);
    return <HuskContextMenu key={`${kind}:${value.id}`}>
      <HuskContextMenuTrigger asChild><div className="rb-item wf-library-item" data-item-id={value.id} data-item-kind={kind} onContextMenu={(event) => event.stopPropagation()}>
        <button type="button" className="rb-run" title={kind === "script" ? "Review & run local script" : "Review & run"} aria-label={"Review & run " + value.name}
          onClick={() => item.kind === "workflow" ? props.onRun(item.value) : props.onRunScript(item.value)}><HugeiconsIcon icon={PlayIcon} size={11} strokeWidth={2} /></button>
        <div className="rb-meta">
          <span className="rb-name" title={value.name}>{value.name}</span>
          <span className="rb-steps" title={item.kind === "script" ? item.value.path : undefined}>{item.kind === "script" ? "Linked script · " + item.value.path : `${item.value.steps.length} step${item.value.steps.length === 1 ? "" : "s"}`}</span>
        </div>
        <div className="wf-library-item-actions">
          <button type="button" className="ai-icon" aria-label={pinLabel} title={pinLabel} aria-pressed={pinnedItem} onClick={pin}><HugeiconsIcon icon={pinnedItem ? PinOffIcon : PinIcon} size={12} /></button>
          {item.kind === "workflow" ? <button type="button" className="ai-icon" title="Edit workflow" aria-label={"Edit " + value.name} onClick={() => props.onEdit(item.value)}><HugeiconsIcon icon={Edit02Icon} size={12} /></button>
            : <button type="button" className="ai-icon" disabled={!props.onOpenScript} title="Open original file" aria-label={"Open " + value.name} onClick={() => item.kind === "script" && props.onOpenScript?.(item.value)}><HugeiconsIcon icon={File02Icon} size={12} /></button>}
        </div>
        {run && <div className="wf-library-run" data-phase={run.phase}>
          <span title={new Date(run.submittedAt).toLocaleString()}>{workflowRunLabel(run)} · {relativeTime(run.completedAt ?? run.submittedAt, now)}</span>
          <button type="button" onClick={() => props.onViewOutput(runKey, value.name)} aria-label={"View output for " + value.name}>View output</button>
        </div>}
      </div></HuskContextMenuTrigger>
      <HuskContextMenuContent title={value.name}>
        <HuskContextMenuItem icon={pinnedItem ? PinOffIcon : PinIcon} onSelect={pin}>{pinnedItem ? "Unpin" : "Pin to top"}</HuskContextMenuItem>
        {item.kind === "workflow" ? <>
          <HuskContextMenuItem icon={PlayIcon} onSelect={() => props.onRun(item.value)}>Review & run…</HuskContextMenuItem>
          <HuskContextMenuItem icon={Edit02Icon} onSelect={() => props.onEdit(item.value)}>Edit workflow…</HuskContextMenuItem>
          <HuskContextMenuItem icon={RepeatIcon} onSelect={() => props.onDuplicate(item.value)}>Duplicate</HuskContextMenuItem>
          <HuskContextMenuSeparator />
          <HuskContextMenuItem icon={Copy01Icon} onSelect={() => props.onCopyCommands(item.value)}>Copy step templates</HuskContextMenuItem>
          <HuskContextMenuItem icon={Copy01Icon} onSelect={() => props.onCopyJson(item.value)}>Copy workflow JSON</HuskContextMenuItem>
          <HuskContextMenuItem icon={Copy01Icon} onSelect={() => props.onExport(item.value)}>Export JSON…</HuskContextMenuItem>
          <HuskContextMenuSeparator />
          <HuskContextMenuItem icon={Delete02Icon} danger onSelect={() => props.onDelete(item.value)}>Delete workflow…</HuskContextMenuItem>
        </> : <>
          <HuskContextMenuItem icon={File02Icon} disabled={!props.onOpenScript} onSelect={() => props.onOpenScript?.(item.value)}>Open original file</HuskContextMenuItem>
          <HuskContextMenuItem icon={PlayIcon} onSelect={() => props.onRunScript(item.value)}>Review & run local script…</HuskContextMenuItem>
          <HuskContextMenuSeparator />
          <HuskContextMenuItem icon={Delete02Icon} danger onSelect={() => props.onRemoveScript(item.value)}>Remove link…</HuskContextMenuItem>
        </>}
      </HuskContextMenuContent>
    </HuskContextMenu>;
  };
  return <div className="wf-library-items">
    {groups.filter((group) => group.items.length > 0).map((group) => <section key={group.name} aria-label={group.name}>
      {showHeadings && <h3 className="wf-library-heading">{group.name}<span>{group.items.length}</span></h3>}
      <div className="rb-list">{group.items.map(renderItem)}</div>
    </section>)}
    {items.length === 0 && needle && <p className="wf-library-empty" role="status">No matching workflows or scripts.</p>}
  </div>;
}
