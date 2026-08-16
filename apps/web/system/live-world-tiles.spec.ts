import { expect, test } from "@playwright/test";
import { ZODIACD_PORT } from "../playwright.config.js";

const ZODIACD_BASE_URL = `http://127.0.0.1:${ZODIACD_PORT}`;

/**
 * The exact same POST /api/world/commands endpoint story 7's agent tool
 * (packages/pi/src/agent-command-tool.ts) and a human dispatch both use --
 * see agent-command-tool.process.test.ts's own server-side proof of this
 * endpoint. A plain fetch, not Playwright's `request` fixture: this is a
 * real server-to-server call from the test process straight to the daemon,
 * not a browser-context-scoped request.
 */
async function postCommand(intent: Record<string, unknown>): Promise<void> {
	const response = await fetch(`${ZODIACD_BASE_URL}/api/world/commands`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ intent }),
	});
	if (!response.ok) throw new Error(`postCommand(${String(intent["type"])}) rejected: ${response.status} ${await response.text()}`);
}

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Zodiac", exact: true })).toBeVisible();
});

/**
 * Proves story 6's Web half (LiveWorldTiles/LiveDaemonPanel, commit
 * 36f88d0) end to end in a real browser: a command dispatched exactly the
 * way an agent's own tool call dispatches it becomes visible on the
 * actually-rendered page, not just in a unit test against a canned view
 * model or a fake daemon.
 *
 * activeWorkspaceId is always the very first Workspace ever created for
 * this daemon's own lifetime (WorldStore.worldViewModel's own
 * `projected[0]`) -- there is no workspace.select CommandIntent yet (a
 * real, separate gap; see the "generalize reconciliation" task's own Doc).
 * Both cases below deliberately share one Workspace, created once, rather
 * than each creating its own -- a second Workspace a later test created
 * would never actually become the one LiveWorldTiles renders.
 */
test.describe.serial("an agent's surface.dock command becomes visible in a running Web page", () => {
	test.beforeAll(async () => {
		await postCommand({ type: "workspace.create", workspaceId: "system-test-ws", title: "System Test Workspace" });
	});

	test("a single docked Surface renders as a tile with its own title", async ({ page }) => {
		await postCommand({ type: "surface.dock", workspaceId: "system-test-ws", integrationId: "activity", title: "Agent-Docked Activity" });

		// The panel is collapsed by default (see LiveDaemonPanel.tsx) -- expand it first.
		await page.getByRole("button", { name: /Live Daemon State/ }).click();

		// SSE propagation from the daemon to the browser isn't instant --
		// Playwright's own auto-retrying expect() polls until this appears,
		// rather than a bare synchronous assertion.
		await expect(page.getByTestId("live-world-tile").filter({ hasText: "Agent-Docked Activity" })).toBeVisible();
	});

	test("a second Surface docked into the same Window renders as a second tile, side by side", async ({ page }) => {
		await postCommand({ type: "surface.dock", workspaceId: "system-test-ws", integrationId: "terminal", title: "Agent-Docked Shell" });

		await page.getByRole("button", { name: /Live Daemon State/ }).click();

		const tiles = page.getByTestId("live-world-tile");
		await expect(tiles).toHaveCount(2);
		await expect(tiles.nth(0)).toHaveText("Agent-Docked Activity");
		await expect(tiles.nth(1)).toHaveText("Agent-Docked Shell");
	});
});
