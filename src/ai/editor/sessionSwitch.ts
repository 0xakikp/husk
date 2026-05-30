/** Pub/sub for switching editor AI sessions from outside the component tree. */

type Callback = (id: string, workspace: string) => void;

let subs: Callback[] = [];

export function subscribeEditorSwitch(fn: Callback): () => void {
  subs.push(fn);
  return () => {
    subs = subs.filter((f) => f !== fn);
  };
}

export function requestEditorSwitch(id: string, workspace: string): void {
  subs.forEach((fn) => fn(id, workspace));
}
