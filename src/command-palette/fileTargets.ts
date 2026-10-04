/** The editor currently keys models by path. Do not silently reuse a model
 * from a different host when a local search result has the same path. */
export function assertLauncherFileSource(
  files: readonly { path: string; remoteHost?: string | null }[],
  path: string,
  remoteHost?: string,
): void {
  const existing = files.find((file) => file.path === path);
  if (existing && (existing.remoteHost ?? null) !== (remoteHost ?? null)) {
    const source = existing.remoteHost ? `SSH ${existing.remoteHost}` : "this computer";
    throw new Error(`This path is already open from ${source}. Close that editor tab before opening the copy from ${remoteHost ? `SSH ${remoteHost}` : "this computer"}.`);
  }
}
