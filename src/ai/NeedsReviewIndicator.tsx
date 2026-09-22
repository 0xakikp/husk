import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { getPendingEdits, subscribePendingEdits } from "./pendingEdits";
import { getPendingMcpActions, subscribePendingMcpActions } from "./pendingActions";
import { useSessionReviewQueue } from "./reviewQueue";
import { collectReviewItems, type TerminalReviewItem } from "./reviewIndicatorItems";
import { revealReviewItem } from "./reviewNavigation";
import "./NeedsReviewIndicator.css";

type Props = { sessionId: string; composerRef: RefObject<HTMLDivElement | null>; terminalItems?: readonly TerminalReviewItem[] };

export function NeedsReviewIndicator(props: Props) {
  return <SessionNeedsReviewIndicator key={props.sessionId} {...props} />;
}

function SessionNeedsReviewIndicator({ sessionId, composerRef, terminalItems = [] }: Props) {
  const edits = useSessionReviewQueue(getPendingEdits, subscribePendingEdits, sessionId);
  const integrations = useSessionReviewQueue(getPendingMcpActions, subscribePendingMcpActions, sessionId);
  const items = collectReviewItems(sessionId, edits, integrations, terminalItems);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const id = useId();
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    if (!open || !items.length) return;
    const anchor = trigger.current?.getBoundingClientRect();
    const size = popover.current?.getBoundingClientRect();
    if (!anchor || !size) return;
    const below = anchor.bottom + 6;
    setPosition({
      left: Math.max(8, Math.min(anchor.right - size.width, window.innerWidth - size.width - 8)),
      top: Math.max(8, Math.min(below + size.height <= window.innerHeight - 8 ? below : anchor.top - size.height - 6, window.innerHeight - size.height - 8)),
    });
    popover.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open, items.length]);

  useEffect(() => { if (!items.length) setOpen(false); }, [items.length]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!popover.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    };
    const resize = () => setOpen(false);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);

  if (!items.length) return null;
  return <>
    <button ref={trigger} type="button" className="needs-review-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={`Needs you: ${items.length} pending review${items.length === 1 ? "" : "s"}`} title="Needs you · review pending actions" onClick={() => setOpen((value) => !value)}>Review · {items.length}</button>
    {open && createPortal(<div ref={popover} id={id} role="dialog" aria-label="Needs you" className="needs-review-popover" style={position} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === "Escape") return;
      event.stopPropagation();
      const buttons = [...(popover.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      } else if (event.key === "Tab" && ((event.shiftKey && index === 0) || (!event.shiftKey && index === buttons.length - 1))) {
        event.preventDefault(); setOpen(false); trigger.current?.focus();
      }
    }}>
      <div className="needs-review-heading">Needs you <span>{items.length}</span></div>
      <p>Open an item to inspect its existing approval card. Nothing runs here.</p>
      <ul>{items.map((item) => <li key={`${item.kind}:${item.id}`}><button type="button" className="needs-review-item" onClick={() => {
        setOpen(false);
        if (composerRef.current) revealReviewItem(composerRef.current, sessionId, item);
      }}>
        <span className="needs-review-label">{item.label}<span aria-hidden="true">↗</span></span>
        <span className="needs-review-target">{item.target}</span>
        {item.detail && <code>{item.detail}</code>}
      </button></li>)}</ul>
    </div>, document.body)}
  </>;
}
