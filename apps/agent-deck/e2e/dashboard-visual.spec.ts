import { expect, test } from "@playwright/test";

/**
 * Visual regression: the one class of bug none of the other E2E specs can
 * catch. dashboard-drag.spec.ts and dashboard-shell.spec.ts assert numeric
 * boundingBox() dimensions and text content -- correct for layout/behavior,
 * but blind to a category color drifting, a contrast fix regressing, an
 * icon disappearing, or spacing changing while every measured box stays the
 * same size. Real prior example this would have caught automatically
 * instead of by luck: the Observability tile's hardcoded #000 label color
 * against the dark theme (1.18:1 contrast) -- a screenshot diff would have
 * flagged the whole page changing the moment the dark theme was toggled,
 * without anyone needing to know to look for that specific tile.
 *
 * toHaveScreenshot() is Playwright's own artifact -- a PNG -- wired
 * directly into the assertion itself (not just a debugging aid on
 * failure): the committed baseline under dashboard-visual.spec.ts-snapshots/
 * IS the test. The viewport is pinned in playwright.config.ts specifically
 * so this is reproducible on any machine, not just the one that generated
 * the baseline.
 *
 * maxDiffPixels: 10, not maxDiffPixelRatio -- calibrated empirically, not
 * guessed. A ratio threshold (tried first at 0.01, i.e. 1%) silently let a
 * real, valid category-color mutation through unnoticed: a 12px icon is a
 * tiny fraction of any screenshot's total pixels (0.1-0.4% here) even
 * cropped tightly to just its own card, so a 1% ratio was never going to
 * fire for small-element regressions no matter the crop size. Measured the
 * real diff directly (forced maxDiffPixels: 0 against a genuine color swap,
 * text-accent-* -> text-danger-*): exactly 16 pixels changed. maxDiffPixels
 * of 10 is below that real regression (confirmed: fails against it) and
 * above the ~0px of jitter headless Chromium actually produces run-to-run
 * on the same OS (confirmed: passes clean on unchanged code) -- an absolute
 * pixel count that doesn't scale away as an image gets larger, unlike a
 * ratio.
 */

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await page.waitForSelector("#dashboard-grid");
	// Let the (intentionally elastic) sidebar/theme transitions fully settle
	// before capturing -- a screenshot mid-transition would never match its
	// own baseline twice in a row.
	await page.waitForTimeout(200);
});

test("empty dashboard shell matches its visual baseline (light mode)", async ({ page }) => {
	await expect(page).toHaveScreenshot("dashboard-shell-light.png", { maxDiffPixels: 10 });
});

test("a generated, filtered widget card matches its visual baseline", async ({ page }) => {
	await page.locator("#prompt-input").fill("Create a widget which show only the CI jobs I've initiated");
	await page.locator("#input-send").click();
	const card = page.locator('[data-widget-type="ci-initiated-by-me"]');
	await expect(card).toBeVisible();
	await expect(card).toHaveScreenshot("generated-ci-card.png", { maxDiffPixels: 10 });
});
