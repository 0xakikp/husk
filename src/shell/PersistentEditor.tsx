import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Moving the host (not the portal target) keeps Monaco, undo, subscriptions and
 * selection intact. There must only be ONE editor registered with the AI bridge. */
export function PersistentEditor({ targetRef, children, layout = "fill" }: {
  targetRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  /** The shared dock uses the same stable-host technique, but sizes itself. */
  layout?: "fill" | "contents";
}) {
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "workspace-editor-host";
    Object.assign(element.style, layout === "contents" ? { display: "contents" } : { height: "100%", width: "100%", minHeight: "0", minWidth: "0", overflow: "hidden" });
    return element;
  });
  // Run after every commit: a previously absent destination may have mounted.
  useLayoutEffect(() => {
    if (targetRef.current && host.parentElement !== targetRef.current) targetRef.current.appendChild(host);
  });
  useLayoutEffect(() => () => { host.remove(); }, [host]);
  return createPortal(children, host);
}
