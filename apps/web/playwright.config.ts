import { defineConfig } from "@playwright/test";

const PORT = 4175;

export default defineConfig({
	testDir: "./system",
	timeout: 20_000,
	fullyParallel: false,
	retries: 0,
	reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		trace: "retain-on-failure",
		viewport: { width: 1280, height: 800 },
	},
	webServer: {
		command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
		url: `http://127.0.0.1:${PORT}`,
		reuseExistingServer: false,
		timeout: 30_000,
		env: { ZODIAC_FIXTURE_MODE: "1", ZODIAC_DEV_PORT: String(PORT) },
	},
});
