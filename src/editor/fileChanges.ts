/** Lightweight notifications: Git must not load Monaco just to refresh editors. */
type Listener = (path: string) => void;
const files = new Set<Listener>();
const repositories = new Set<Listener>();

function emit(listeners: Set<Listener>, path: string) {
  for (const listener of listeners) { try { listener(path); } catch { /* Isolate subscribers. */ } }
}
export function onFileChanged(path: string) { emit(files, path); }
export function watchFileChanges(listener: Listener): () => void {
  files.add(listener); return () => { files.delete(listener); };
}
export function onRepositoryFilesChanged(root: string) { emit(repositories, root); }
export function watchRepositoryChanges(listener: Listener): () => void {
  repositories.add(listener); return () => { repositories.delete(listener); };
}
