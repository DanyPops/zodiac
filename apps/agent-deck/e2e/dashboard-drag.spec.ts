import { expect, test, type Page } from "@playwright/test";

/**
 * Real drag-and-drop E2E coverage for the Dashboard grid.
 *
 * Root cause this suite exists to catch, found via RCA after a real human
 * reported "nothing happens when I drop it inside" (automated mouse-event
 * simulation had been failing too, but was initially misdiagnosed as a
 * simulation artifact -- gridstack's own maintainers don't automate external
 * drag-in either, which was a red herring): an empty gridstack container
 * computes its own height from content and collapses to 0px when it has no
 * items (default minRow: 0). The large empty area a person sees is the
 * parent <section>'s background, not the actual grid-stack element -- the
 * only thing with real drop-target behavior attached occupied zero actual
 * pixels, so no drop could ever land "inside" it, for a human or a script.
 * Fixed with minRow (dashboard-grid.ts). The first test below is the direct
 * regression guard for that specific failure mode.
 *
 * Drag sources are no longer a fixed pre-populated catalog -- per direct
 * correction, a widget only exists after asking for it with a specific
 * scope ("Create a widget which shows only the CI jobs I've initiated").
 * submitPrompt below drives the real input box exactly as a person would.
 */

async function submitPrompt(page: Page, prompt: string): Promise<void> {
	await page.locator("#prompt-input").fill(prompt);
	await page.locator("#input-send").click();
}

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await page.waitForSelector("#dashboard-grid");
});

test("an empty dashboard grid has real, non-zero hoverable area", async ({ page }) => {
	const gridBox = await page.locator("#dashboard-grid").boundingBox();
	expect(gridBox).not.toBeNull();
	expect(gridBox!.height).toBeGreaterThan(0);
});

test("dragging a widget generated from a prompt lands it in the Dashboard grid", async ({ page }) => {
	await submitPrompt(page, "Create a widget which show only the CI jobs I've initiated");
	const source = page.locator('[data-widget-type="ci-initiated-by-me"]');
	await expect(source).toBeVisible();

	const sourceBox = await source.boundingBox();
	const targetBox = await page.locator("#dashboard-grid").boundingBox();
	expect(sourceBox).not.toBeNull();
	expect(targetBox).not.toBeNull();

	// Matches gridstack's own real e2e test pattern (verified against their
	// actual test suite, ~/Repositories/gridstack.js/e2e/gridstack-e2e.spec.ts)
	// -- mousedown, then a single stepped move to the target, then mouseup.
	await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
	await page.mouse.down();
	await page.mouse.move(targetBox!.x + 100, targetBox!.y + 80, { steps: 10 });
	await page.mouse.up();

	await expect(page.locator(".grid-stack-item")).toHaveCount(1);
	await expect(page.locator(".grid-stack-item").first()).toContainText("CI jobs I've initiated");
});

test("a dropped widget persists across reload with its real, filtered rendered content", async ({ page }) => {
	await submitPrompt(page, "Create a widget which only shows the bugs which are assigned to me");
	const source = page.locator('[data-widget-type="tickets-assigned-to-me"]');
	await expect(source).toBeVisible();

	const sourceBox = await source.boundingBox();
	const targetBox = await page.locator("#dashboard-grid").boundingBox();

	await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
	await page.mouse.down();
	await page.mouse.move(targetBox!.x + 100, targetBox!.y + 80, { steps: 10 });
	await page.mouse.up();
	await expect(page.locator(".grid-stack-item")).toHaveCount(1);

	await page.reload();
	await page.waitForSelector("#dashboard-grid");

	await expect(page.locator(".grid-stack-item")).toHaveCount(1);
	// Real, filtered content, not just an empty grid cell or the unfiltered
	// catalog view -- proves the full save -> load -> render pipeline
	// reconstructed the *specific scope* that was asked for, not just a bare
	// "tickets" widget.
	await expect(page.locator(".grid-stack-item")).toContainText("Bugs assigned to me");
});

test("an unrecognized prompt fails visibly instead of silently doing nothing", async ({ page }) => {
	await submitPrompt(page, "what's the weather like");
	await expect(page.locator("#prompt-error")).toBeVisible();
	await expect(page.locator("#prompt-error")).toContainText("don't recognize");
	await expect(page.locator(".fixture-drag-source")).toHaveCount(0);
});
