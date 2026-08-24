import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename } from "node:path";

const dist = new URL("../dist/", import.meta.url);
const html = readFileSync(new URL("index.html", dist), "utf8");
const entryMatch = html.match(/<script[^>]+src="\/assets\/([^"]+\.js)"/);
if (!entryMatch) throw new Error("Could not find the production entry script");

const assetsDir = new URL("assets/", dist);
const entryBytes = statSync(new URL(entryMatch[1], assetsDir)).size;
const appName = readdirSync(assetsDir).find((name) => /^App-.*\.js$/.test(name));
if (!appName) throw new Error("Could not find the lazy application chunk");
const appBytes = statSync(new URL(appName, assetsDir)).size;

const maxEntryBytes = 350 * 1024;
const maxAppBytes = 1536 * 1024;
if (entryBytes > maxEntryBytes) {
  throw new Error(`Startup entry ${basename(entryMatch[1])} is ${entryBytes} bytes (budget ${maxEntryBytes})`);
}
if (appBytes > maxAppBytes) {
  throw new Error(`Application shell ${appName} is ${appBytes} bytes (budget ${maxAppBytes})`);
}

const optionalPreload = /monaco|editorarea|terminalaicomposer|settingspage|totpdialog|sentry/i;
const preloads = [...html.matchAll(/rel="modulepreload"[^>]+href="\/assets\/([^"]+)"/g)].map((match) => match[1]);
const leaked = preloads.filter((name) => optionalPreload.test(name));
if (leaked.length) {
  throw new Error(`Optional features leaked into startup preloads: ${leaked.join(", ")}`);
}

console.log(
  `startup bundle ok: entry ${(entryBytes / 1024).toFixed(1)} KB, app ${(appBytes / 1024).toFixed(1)} KB, ${preloads.length} preload(s)`,
);
