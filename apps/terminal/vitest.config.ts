import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    server: { deps: { inline: ["@danypops/pi-tui-harness"] } },
  },
  resolve: {
    alias: {
      "@xterm/headless": fileURLToPath(new URL("./src/test/xterm-headless-shim.ts", import.meta.url)),
    },
  },
});
