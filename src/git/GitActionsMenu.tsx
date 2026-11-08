import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/** Keep pointer and keyboard navigation on one item without invoking its action. */
export function GitActionsMenu({ children }: { children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const highlighted = useRef<HTMLButtonElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const input = useRef<"pointer" | "keyboard">("pointer");
  const frame = useRef<number | null>(null);

  const mark = (button: HTMLButtonElement | null) => {
    if (button?.disabled) button = null;
    highlighted.current?.removeAttribute("data-highlighted");
    highlighted.current = button;
    button?.setAttribute("data-highlighted", "");
  };
  const modality = (value: "pointer" | "keyboard") => {
    input.current = value;
    if (details.current) details.current.dataset.input = value;
  };
  const cancelFrame = () => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  const close = (restoreFocus = false) => {
    if (details.current) details.current.open = false;
    mark(null);
    pointer.current = null;
    cancelFrame();
    if (restoreFocus) details.current?.querySelector("summary")?.focus({ preventScroll: true });
  };
  const itemAt = (target: EventTarget | null) => {
    const button = target instanceof Element ? target.closest("button") : null;
    return button instanceof HTMLButtonElement && content.current?.contains(button) && !button.disabled ? button : null;
  };
  const followPointer = (target: EventTarget | null) => {
    if (!details.current?.open) return;
    const button = itemAt(target);
    mark(button);
    if (button) button.focus({ preventScroll: true });
    else if (content.current?.contains(document.activeElement)) content.current.focus({ preventScroll: true });
  };
  const afterScroll = () => {
    if (input.current !== "pointer" || !pointer.current || frame.current !== null) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      if (!details.current?.open || input.current !== "pointer" || !pointer.current) return;
      const { x, y } = pointer.current;
      followPointer(document.elementFromPoint(x, y));
    });
  };
  const trackPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    modality("pointer");
    pointer.current = { x: event.clientX, y: event.clientY };
    followPointer(event.target);
  };

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (details.current?.open && event.target instanceof Node && !details.current.contains(event.target)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); cancelFrame(); };
  }, []);

  // A refresh can disable a previously highlighted action while this stays open.
  useEffect(() => {
    if (highlighted.current && (highlighted.current.disabled || !content.current?.contains(highlighted.current))) mark(null);
  });

  return <details className="git-more" ref={details} data-input="pointer"
    onToggle={(event) => { if (!event.currentTarget.open) { mark(null); pointer.current = null; cancelFrame(); } }}
    onBlurCapture={(event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) close();
    }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      modality("keyboard");
      cancelFrame();
      if (event.key === "Escape" && event.currentTarget.open) {
        event.preventDefault(); event.stopPropagation(); close(true); return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const wasOpen = event.currentTarget.open;
      event.currentTarget.open = true;
      const buttons = [...(content.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      if (!buttons.length) { content.current?.focus({ preventScroll: true }); return; }
      const current = wasOpen ? buttons.indexOf(document.activeElement as HTMLButtonElement) : -1;
      const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : event.key === "ArrowDown" ? (current + 1) % buttons.length : current < 0 ? buttons.length - 1 : (current - 1 + buttons.length) % buttons.length;
      const button = buttons[index];
      mark(button);
      button.focus({ preventScroll: true });
      button.scrollIntoView?.({ block: "nearest" });
    }}>
    <summary aria-label="More Git actions" title="More Git actions"
      onPointerDown={(event) => { if (event.pointerType !== "touch") modality("pointer"); }}>⋯</summary>
    <div className="git-more-items" ref={content} aria-label="More Git actions" tabIndex={-1}
      onFocusCapture={(event) => mark(itemAt(event.target))}
      onPointerMove={trackPointer}
      // Pointer-over can also result from keyboard-induced scrolling. Only a
      // fresh movement/wheel should switch an existing keyboard session back.
      onPointerOver={(event) => { if (input.current === "pointer") trackPointer(event); }}
      onPointerLeave={(event) => {
        if (event.pointerType === "touch") return;
        pointer.current = null;
        cancelFrame();
        if (input.current === "pointer") followPointer(null);
      }}
      onWheel={(event) => {
        modality("pointer");
        pointer.current = { x: event.clientX, y: event.clientY };
        afterScroll();
      }}
      onScroll={afterScroll}
      onClick={(event) => { if (itemAt(event.target)) close(true); }}>
      {children}
    </div>
  </details>;
}
