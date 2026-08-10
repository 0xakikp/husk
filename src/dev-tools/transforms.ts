export type DevToolMode = "json" | "jwt" | "base64" | "url" | "uuid" | "timestamp";
export type JsonOperation = "format" | "minify";

export const DEV_TOOL_MODES: Array<{ id: DevToolMode; label: string; hint: string }> = [
  { id: "json", label: "JSON", hint: "Format or minify" },
  { id: "jwt", label: "JWT", hint: "Decode locally" },
  { id: "base64", label: "Base64", hint: "Encode or decode" },
  { id: "url", label: "URL", hint: "Encode or decode" },
  { id: "uuid", label: "UUID", hint: "Generate v4" },
  { id: "timestamp", label: "Time", hint: "Convert timestamps" },
];

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeJwtSegment(value: string): unknown {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return JSON.parse(fromBase64(padded));
}

function timestampDetails(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("Enter a Unix timestamp or an ISO date.");
  const number = Number(input);
  const date = Number.isFinite(number) && input !== ""
    ? new Date(Math.abs(number) < 100_000_000_000 ? number * 1_000 : number)
    : new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error("That is not a valid timestamp or date.");
  return [
    `ISO: ${date.toISOString()}`,
    `Local: ${date.toLocaleString()}`,
    `Unix seconds: ${Math.floor(date.getTime() / 1_000)}`,
    `Unix milliseconds: ${date.getTime()}`,
  ].join("\n");
}

function makeUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Browser builds always have randomUUID. This fallback only keeps the tool
  // usable in older webviews; it is an identifier, not a secret generator.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

/** All transformations run in the webview; input is never sent to a service. */
export function transformDevValue(
  mode: DevToolMode,
  input: string,
  options: { jsonOperation?: JsonOperation; decode?: boolean } = {},
): { output: string; note?: string } {
  switch (mode) {
    case "json": {
      const value = JSON.parse(input);
      return { output: options.jsonOperation === "minify" ? JSON.stringify(value) : JSON.stringify(value, null, 2) };
    }
    case "jwt": {
      const [header, payload] = input.trim().split(".");
      if (!header || !payload) throw new Error("Enter a JWT with header and payload segments.");
      return {
        output: JSON.stringify({ header: decodeJwtSegment(header), payload: decodeJwtSegment(payload) }, null, 2),
        note: "Decoded only — signature verification is not performed.",
      };
    }
    case "base64":
      return { output: options.decode ? fromBase64(input.trim()) : toBase64(input) };
    case "url":
      return { output: options.decode ? decodeURIComponent(input) : encodeURIComponent(input) };
    case "uuid":
      return { output: makeUuid() };
    case "timestamp":
      return { output: timestampDetails(input) };
  }
}
