import { expect, test } from "@playwright/test";
import { ZODIACD_PORT } from "../playwright.config.js";

const ZODIACD_BASE_URL = `http://127.0.0.1:${ZODIACD_PORT}`;

async function getWorkspaceIds(): Promise<readonly string[]> {
	const response = await fetch(`${ZODIACD_BASE_URL}/api/world`);
	const body = (await response.json()) as { workspaces: readonly { id: string }[] };
	return body.workspaces.map((workspace) => workspace.id);
}

/**
 * Task 8facba42's own real fix: RemoteWorldStore.apply() now marks its own
 * POST /api/world/commands `keepalive: true` (remote-world-store.test.ts's
 * own unit test proves the flag itself is always set). This is the
 * end-to-end proof that a command dispatched from a real page, immediately
 * followed by a navigation racing it, still reaches the daemon --
 * unconfirmed in this fast local-loopback environment without the flag
 * (a genuinely slower real-world round trip, e.g. the auto-create flow's
 * own LLM title-rename, is what originally surfaced this in production).
 */
test("a command dispatched with keepalive, immediately followed by a navigation, still reaches the daemon", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Zodiac", exact: true })).toBeVisible();

	const workspaceId = `apply-keepalive-${Date.now()}`;
	// No dev-server proxy exists (see vite.config.ts) -- the real app
	// dispatches to the daemon's own absolute origin (VITE_ZODIACD_URL), not
	// a relative path, so this must too.
	await page.evaluate(
		({ id, baseUrl }) => {
			void fetch(`${baseUrl}/api/world/commands`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: id, title: "Should survive navigation" } }),
				keepalive: true,
			});
		},
		{ id: workspaceId, baseUrl: ZODIACD_BASE_URL },
	);
	// No wait for the fetch's own response -- the whole point is racing a
	// navigation against it, not giving it time to land first.
	await page.goto("/");

	await expect
		.poll(async () => (await getWorkspaceIds()).includes(workspaceId), { timeout: 5_000 })
		.toBe(true);
});
