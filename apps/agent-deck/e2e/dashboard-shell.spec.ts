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
	// The sidebar animates its width/height over a 500ms CSS transition --
	// measuring immediately catches a mid-transition value, not the settled
	// state (confirmed by actually running this: got 213px, neither the
	// expanded 220px nor the collapsed ~40px -- a genuine bug in this test,
	// not the app).
	await page.waitForTimeout(600);

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
	await page.waitForTimeout(600);
	await expect(page.locator("#conversation-sidebar")).toBeHidden();

	await page.locator("#sidebar-expand-toggle").click();
	await page.waitForTimeout(600);

	// Full settled width, not a loose ">150" that a mid-transition value could
	// also satisfy -- the point is confirming it actually finished expanding.
	const box = await page.locator("#conversations-sidebar").boundingBox();
	expect(box!.width).toBeGreaterThan(200);
	await expect(page.locator("#conversation-sidebar")).toBeVisible();
});

test("sidebar collapse toggle has a real rubber-band overshoot, not a plain linear/ease transition", async ({ page }) => {
	// cubic-bezier(0.68, -0.6, 0.32, 1.6) (easeInOutBack) is only a genuine
	// "rubber" effect if the animated width actually leaves the [end, start]
	// range mid-transition -- a claim that it "looks bouncy" isn't evidence.
	// Poll the real boundingBox() throughout the 500ms transition and check
	// both signatures the curve's negative/>1 control points predict: a
	// stretch-wider-than-220px dip right after starting to collapse (y < 0
	// early on), and a shrink-narrower-than-40px overshoot before it settles
	// (y > 1 late on).
	const widths: number[] = [];
	await page.locator("#sidebar-collapse-toggle").click();
	const deadline = Date.now() + 650;
	while (Date.now() < deadline) {
		const box = await page.locator("#conversations-sidebar").boundingBox();
		if (box) widths.push(box.width);
	}

	expect(widths.some((w) => w > 222)).toBe(true); // stretched past the 220px starting width
	expect(widths.some((w) => w < 38)).toBe(true); // overshot past the 40px collapsed target
	expect(widths[widths.length - 1]).toBeLessThan(45); // settles back at the real collapsed width
});

test("sidebar collapses diagonally -- width and height move together, not sequentially", async ({ page }) => {
	// The original bug this guards against: height was driven by toggling
	// align-self (self-stretch <-> self-start), a keyword browsers cannot
	// interpolate -- it snapped instantly while width eased smoothly, so the
	// box shrank sideways and only then snapped short, not a real diagonal.
	// Fixed by making height an explicit, transitionable length on both ends
	// (h-[calc(100vh_-_24px)] <-> h-10). Proof: sample points mid-transition
	// where BOTH dimensions are simultaneously between their start and end
	// values -- if height still snapped, no such point would exist because
	// it would already equal its final 40px the instant width started moving.
	const expandedBox = await page.locator("#conversations-sidebar").boundingBox();
	const startHeight = expandedBox!.height;

	const samples: { w: number; h: number }[] = [];
	await page.locator("#sidebar-collapse-toggle").click();
	const deadline = Date.now() + 480;
	while (Date.now() < deadline) {
		const box = await page.locator("#conversations-sidebar").boundingBox();
		if (box) samples.push({ w: box.width, h: box.height });
	}

	const bothMidTransition = samples.some((s) => s.w < 218 && s.w > 42 && s.h < startHeight - 2 && s.h > 42);
	expect(bothMidTransition).toBe(true);

	// And height genuinely varies across many distinct values (real
	// interpolation), not a single instant jump from startHeight to 40.
	const distinctHeights = new Set(samples.map((s) => Math.round(s.h)));
	expect(distinctHeights.size).toBeGreaterThan(5);
});

test("sidebar collapse state persists across reload", async ({ page }) => {
	await page.locator("#sidebar-collapse-toggle").click();
	await page.reload();
	await page.waitForSelector("#dashboard-grid");

	const box = await page.locator("#conversations-sidebar").boundingBox();
	expect(box!.width).toBeLessThan(60);
});

test("Conversation History starts empty with a hint, not a pre-populated catalog", async ({ page }) => {
	// Per direct correction: widgets are the result of asking for them with a
	// specific scope, not picked off a fixed shelf that's there from the start.
	await expect(page.locator(".fixture-drag-source")).toHaveCount(0);
	await expect(page.locator("text=Ask Alef to create a widget")).toBeVisible();
});

test("a generated widget card renders its real, filtered content, not just an icon and label", async ({ page }) => {
	await page.locator("#prompt-input").fill("Create a widget which show only the CI jobs I've initiated");
	await page.locator("#input-send").click();

	const card = page.locator('[data-widget-type="ci-initiated-by-me"]');
	// The real tile renderer's own subtitle text, not the bare card title --
	// proves the actual filtered renderer ran inside the card.
	await expect(card).toContainText("CI jobs I've initiated");
	// And the empty-state hint is gone now that a real card exists.
	await expect(page.locator("text=Ask Alef to create a widget")).toHaveCount(0);
});

test("Dashboard and Conversation are real, separately-titled dockview panels", async ({ page }) => {
	const tabs = await page.locator(".dv-tab").allTextContents();
	expect(tabs.some((t) => t.includes("Dashboard"))).toBe(true);
	expect(tabs.some((t) => t.includes("Conversation"))).toBe(true);
});
