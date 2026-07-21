import { homedir } from "node:os";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { createSessionJsonlSource } from "./src/ingest/session-jsonl-source.js";
import type { NormalizedEvent } from "./src/ingest/types.js";

/**
 * Dev-only bridge: our ingestion Source is Node-only (node:fs, node:readline),
 * since it reads local session files directly — it cannot run in a browser.
 * This Vite middleware runs it on the server side and exposes it to the page
 * over a plain HTTP endpoint, so the browser has something real to render
 * without waiting for the full graph/tiling layers to be built first.
 *
 * `?file=` selects a session JSONL file; defaults to the committed synthetic
 * fixture so `npm run dev` works with no other setup.
 */
function sessionEventsApiPlugin(): Plugin {
	return {
		name: "agent-deck-session-events-api",
		configureServer(server) {
			server.middlewares.use("/api/events", (req, res) => {
				const url = new URL(req.url ?? "", "http://localhost");
				const filePath = url.searchParams.get("file") ?? join(process.cwd(), "test/fixtures/session-sample.jsonl");
				const sessionId = url.searchParams.get("sessionId") ?? "fixture";

				const events: NormalizedEvent[] = [];
				const source = createSessionJsonlSource({ filePath, sessionId });
				const handle = source.ingest((event) => events.push(event));

				setTimeout(() => {
					handle.dispose();
					res.setHeader("Content-Type", "application/json");
					res.end(JSON.stringify({ filePath, sessionId, events }));
				}, 150);
			});
		},
	};
}

// Convenience: allow ?file=~/... to reach real session files under the home directory.
export const HOME = homedir();

export default defineConfig({
	plugins: [tailwindcss(), sessionEventsApiPlugin()],
	build: {
		rollupOptions: {
			input: {
				main: join(process.cwd(), "index.html"),
				playground: join(process.cwd(), "playground.html"),
			},
		},
	},
});
