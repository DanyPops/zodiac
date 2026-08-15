import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	build: {
		rollupOptions: {
			// This key names the entry chunk Vite/Rollup emits (dist/assets/zodiac-*.js)
			// -- check-bundle-budget.mjs's own ENTRY_PREFIX must match it exactly.
			input: { zodiac: resolve(__dirname, "index.html") },
		},
	},
	test: {
		exclude: ["**/node_modules/**", "**/system/**"],
		setupFiles: ["./src/test-setup.ts"],
	},
});
