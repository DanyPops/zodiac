import { expect, test } from "@playwright/test";
import { ZODIACD_PORT } from "../playwright.config.js";

const ZODIACD_BASE_URL = `http://127.0.0.1:${ZODIACD_PORT}`;

interface WorldSnapshot {
	workspaces: { windows: { surfaces: { id: string }[] }[] }[];
}

async function postCommand(intent: Record<string, unknown>): Promise<void> {
	const response = await fetch(`${ZODIACD_BASE_URL}/api/world/commands`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ intent }),
	});
	if (!response.ok) throw new Error(`postCommand(${String(intent["type"])}) rejected: ${response.status} ${await response.text()}`);
}

async function getWorld(): Promise<WorldSnapshot> {
	const response = await fetch(`${ZODIACD_BASE_URL}/api/world`);
	return response.json();
}

/**
 * Regression for a real, confirmed data-loss bug: WindowDockview's own
 * remount key read the local mock's window id, which stopped changing once
 * the Window carousel cutover removed its local dispatch calls. Switching
 * windows never remounted the docking engine, so its own mount/unmount
 * effect misread the new window's different Surface list as "everything
 * from the old window was removed" and dispatched real `surface.undock`
 * calls -- confirmed live via `GET /api/world` showing every Window left
 * with `surfaces: []` after nothing more than switching the Carousel.
 *
 * Creates the Workspace directly via the daemon's own command endpoint
 * (same pattern as live-world-tiles.spec.ts), not through the chat
 * composer -- the auto-create-then-LLM-rename path is unrelated to this
 * regression and its own async naming step is a real, separate source of
 * flake in this sandbox (no live LLM credits) not worth entangling here.
 */
test("switching windows in the Carousel never undocks Surfaces from either window", async ({ page }) => {
	await postCommand({ type: "workspace.create", workspaceId: "ws-window-switch", title: "Window switch regression" });
	await postCommand({ type: "surface.dock", workspaceId: "ws-window-switch", integrationId: "activity", title: "Activity", surfaceId: "surface-a" });

	await page.goto("/");
	await expect(page.getByRole("region", { name: "Activity" })).toBeVisible();

	await page.getByRole("button", { name: "New Window" }).click();
	await expect(page.getByText("Window 1")).toBeVisible();
	await page.getByRole("button", { name: "Dock Lector" }).click();
	await expect(page.getByRole("region", { name: "Lector" })).toBeVisible();

	await page.locator("[aria-label='Window Carousel'] button[data-window-index='0']").click();
	await expect(page.getByRole("region", { name: "Activity" })).toBeVisible();

	const world = await getWorld();
	const surfaceCounts = world.workspaces[0]?.windows.map((window) => window.surfaces.length);
	expect(surfaceCounts).toEqual([1, 1]);
});
