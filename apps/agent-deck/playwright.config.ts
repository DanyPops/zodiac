import { defineConfig } from "@playwright/test";

/**
 * Real E2E tests, separate from vitest's unit suite -- for behavior that
 * genuinely requires a real DOM/layout/browser (drag-and-drop, real
 * rendered dimensions), not mockable in jsdom. Runs against the actual
 * dev server so gridstack/dockview/sigma all behave as they do in real use.
 *
 * This exists specifically because the dashboard drag-and-drop bug (empty
 * gridstack container collapsing to 0px height, confirmed via
 * getBoundingClientRect -- see dashboard-grid.ts) went undetected through
 * unit tests, a clean build, and even several rounds of manual mouse-event
 * simulation scripts, and was only caught by a real human trying it. A
 * committed, repeatable E2E test is the actual fix for "how do we make sure
 * this doesn't regress silently again."
 */
export default defineConfig({
	testDir: "./e2e",
	timeout: 15_000,
	fullyParallel: false,
	retries: 0,
	reporter: "list",
	use: {
		baseURL: "http://localhost:5173",
		trace: "retain-on-failure",
	},
	webServer: {
		command: "npm run dev",
		url: "http://localhost:5173",
		reuseExistingServer: true,
		timeout: 20_000,
	},
});
