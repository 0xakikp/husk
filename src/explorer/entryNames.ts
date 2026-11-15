/** Create/rename inputs are basenames, never paths or shell arguments. */
export function entryNameError(name: string): string | null {
  if (!name.trim()) return "Enter a file or folder name.";
  if (name === "." || name === ".." || /[\\/\u0000-\u001f\u007f]/.test(name)) return "Use a name, not a path. Slashes and control characters are not allowed.";
  return null;
}

/** Display exact unusual names without letting controls/bidi disguise them. */
export function displayEntryName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
