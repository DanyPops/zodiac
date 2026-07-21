import { expect, test } from "@playwright/test";

/**
 * Real E2E coverage for the app shell: sidebar collapse, Conversation
 * History content previews, and the Dashboard/Conversation dockview panels.
 *
 * These three behaviors were each verified once via throwaway /tmp scripts
 * and then the evidence was deleted -- a real regression risk pointed out
 * directly. This file is the fix: the same checks, committed permanently
 * instead of re-derived by hand next time something looks different.
 */

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await page.waitForSelector("#dashboard-grid");
});

test("sidebar collapses to a small floating button, not a full-height strip", async ({ page }) => {
	const expandedBox = await page.locator("#conversations-sidebar").boundingBox();
	expect(expandedBox!.width).toBeGreaterThan(150);
	expect(expandedBox!.height).toBeGreaterThan(500);

	await page.locator("#sidebar-collapse-toggle").click();
	// The sidebar animates its width/height over a 300ms CSS transition --
	// measuring immediately catches a mid-transition value, not the settled
	// state (confirmed by actually running this: got 213px, neither the
	// expanded 220px nor the collapsed ~40px -- a genuine bug in this test,
	// not the app).
	await page.waitForTimeout(350);

	const collapsedBox = await page.locator("#conversations-sidebar").boundingBox();
	// The point of this test: collapsed must be a small square button, not a
	// full-height narrow bar. Both dimensions small, not just width.
	expect(collapsedBox!.width).toBeLessThan(60);
	expect(collapsedBox!.height).toBeLessThan(60);

	// The conversation list itself must be genuinely hidden, not just visually
	// narrowed with content still present underneath.
	await expect(page.locator("#conversation-sidebar")).toBeHidden();
});

test("sidebar expands back to full size and the conversation list becomes visible again", async ({ page }) => {
	await page.locator("#sidebar-collapse-toggle").click();
	await page.waitForTimeout(350);
	await expect(page.locator("#conversation-sidebar")).toBeHidden();

	await page.locator("#sidebar-expand-toggle").click();
	await page.waitForTimeout(350);

	// Full settled width, not a loose ">150" that a mid-transition value could
	// also satisfy -- the point is confirming it actually finished expanding.
	const box = await page.locator("#conversations-sidebar").boundingBox();
	expect(box!.width).toBeGreaterThan(200);
	await expect(page.locator("#conversation-sidebar")).toBeVisible();
});

test("sidebar collapse state persists across reload", async ({ page }) => {
	await page.locator("#sidebar-collapse-toggle").click();
	await page.reload();
	await page.waitForSelector("#dashboard-grid");

	const box = await page.locator("#conversations-sidebar").boundingBox();
	expect(box!.width).toBeLessThan(60);
});

test("Conversation History cards render real content, not just an icon and label", async ({ page }) => {
	const ciCard = page.locator('[data-widget-type="ci"]');
	// The fixture tile's own real subtitle text, not the bare "CI" label --
	// proves the actual renderer ran inside the card, not just a catalog pill.
	await expect(ciCard).toContainText("Continuous integration");

	const ticketsCard = page.locator('[data-widget-type="tickets"]');
	await expect(ticketsCard).toContainText("Issue tracker");
});

test("Dashboard and Conversation are real, separately-titled dockview panels", async ({ page }) => {
	const tabs = await page.locator(".dv-tab").allTextContents();
	expect(tabs.some((t) => t.includes("Dashboard"))).toBe(true);
	expect(tabs.some((t) => t.includes("Conversation"))).toBe(true);
});
