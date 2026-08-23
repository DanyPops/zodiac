import { defineConfig } from "@playwright/test";

const WEB_PORT = 4175;
// Exported so a spec that needs to talk to zodiacd directly (its own API
// now lives on a different origin than the web app -- see "browser APIs
// expose opaque conversation identity" in workspace-slice.spec.ts) doesn't
// hardcode a second, driftable copy of this port.
export const ZODIACD_PORT = 4176;
const ZODIACD_STATE_DIR = "test-results/zodiacd-state";

export default defineConfig({
	testDir: "./system",
	timeout: 20_000,
	fullyParallel: false,
	retries: 0,
	reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
	use: {
		baseURL: `http://127.0.0.1:${WEB_PORT}`,
		trace: "retain-on-failure",
		viewport: { width: 1280, height: 800 },
	},
	// Two real processes, exactly the zodiacd stage-4 production shape (a
	// standalone daemon a browser-served build talks to over HTTP) --
	// replaces the old single Vite-dev-only webServer entry that used to
	// also serve /api/conversations/etc itself. --fixture-mode gives
	// deterministic, filesystem-free conversations (see
	// apps/service/src/fixtures) so a run never scans (or requires) a real
	// ~/.local/share/alef/sessions. The state dir is wiped before each run
	// so a prior run's Workspaces/World never leak into this one.
	webServer: [
		{
			// zodiacd's own origin-allowlist defaults to apps/web's *dev-server*
			// port (5173, parse-args.ts's DEFAULT_ALLOWED_ORIGINS) -- this suite
			// serves Web on WEB_PORT instead, so every live browser->zodiacd
			// call (SSE, conversation fetch) would otherwise get a real 403
			// origin-not-allowed rejection. Confirmed root cause of 5 apparently
			// unrelated system-test failures (a "Failed to fetch" Chat error, a
			// live-tile that never renders, and 3 visual-snapshot diffs -- all
			// really the same rejected-origin bug, not font/timing flakiness).
			command: `rm -rf ${ZODIACD_STATE_DIR} && cd ../.. && npm run build --workspace=@zodiac/service && node apps/service/dist/cli.js --port ${ZODIACD_PORT} --host 127.0.0.1 --fixture-mode --state-dir apps/web/${ZODIACD_STATE_DIR} --allowed-origin http://127.0.0.1:${WEB_PORT}`,
			url: `http://127.0.0.1:${ZODIACD_PORT}/healthz`,
			reuseExistingServer: false,
			timeout: 30_000,
		},
		{
			command: `npm run dev -- --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
			url: `http://127.0.0.1:${WEB_PORT}`,
			reuseExistingServer: false,
			timeout: 30_000,
			env: { ZODIAC_DEV_PORT: String(WEB_PORT), VITE_ZODIACD_URL: `http://127.0.0.1:${ZODIACD_PORT}` },
		},
	],
});
