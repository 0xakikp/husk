import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

/**
 * Keep the first test suite deliberately lightweight: it runs in Node and
 * exercises Husk's pure state and safety rules without launching a WebView or
 * a Tauri process. Native and end-to-end coverage can build on this command.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
