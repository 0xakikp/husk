import { defineConfig } from "vitest/config";

/**
 * Keep the first test suite deliberately lightweight: it runs in Node and
 * exercises Husk's pure state and safety rules without launching a WebView or
 * a Tauri process. Native and end-to-end coverage can build on this command.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
