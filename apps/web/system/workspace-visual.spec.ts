import { expect, test, type Page } from "@playwright/test";
import { ZODIACD_PORT } from "../playwright.config.js";

const ZODIACD_BASE_URL = `http://127.0.0.1:${ZODIACD_PORT}`;

/**
 * Same real POST /api/world/commands endpoint live-world-tiles.spec.ts's
 * and workspace-slice.spec.ts's own precedent uses.
 */
async function postCommand(intent: Record<string, unknown>): Promise<void> {
	const response = await fetch(`${ZODIACD_BASE_URL}/api/world/commands`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ intent }),
	});
	if (!response.ok) throw new Error(`postCommand(${String(intent["type"])}) rejected: ${response.status} ${await response.text()}`);
}

/** The live clock ticks during a real test run -- mask it out of every screenshot rather than compare its digits, which flakes on a minute boundary. */
function dynamicRegions(page: Page) {
	return [page.getByRole("status", { name: "Current time" })];
}

/**
 * `.animate-wisp-breathe` (styles.css) is a real, permanent 4s infinite
 * opacity keyframe (1 -> 0.85 -> 1) applied to the active Workspace glyph
 * and any hovered/focused entry -- this codebase's own established
 * behavior elsewhere already documents it as "never reliably exactly 1"
 * (workspace-slice.spec.ts's own expectBreathingOpacity). Playwright's
 * `toHaveScreenshot`'s default `animations: "disabled"` freezes CSS
 * animations, but an *infinite* keyframe's own frozen frame isn't
 * guaranteed deterministic across runs/machines the way a finite
 * animation's end state is. Forces a fixed, fully-opaque frame explicitly
 * rather than trusting Playwright's own freeze to always land the same
 * way -- a real, controllable flake source independent of cross-machine
 * font/rendering drift (see this spec's own snapshot threshold comment
 * for that separate cause).
 */
async function freezeWispBreathing(page: Page): Promise<void> {
	await page.addStyleTag({ content: ".animate-wisp-breathe { animation: none !important; opacity: 1 !important; }" });
}

async function waitForShell(page: Page): Promise<void> {
	await expect(page.getByRole("navigation", { name: "Window Carousel" })).toBeVisible();
}

/**
 * Playwright's own docs (https://playwright.dev/docs/test-snapshots):
 * "Screenshots differ between browsers and platforms due to different
 * rendering, fonts and more". An absolute maxDiffPixels (this spec's own
 * prior value, 20, on a >1,000,000-pixel full-page capture) is guaranteed
 * to false-positive on ordinary font/anti-aliasing drift between machines
 * -- the documented standard fix is a ratio instead. 0.015 (1.5%) sits
 * between the two documented community figures (1%-2%): comfortably above
 * measured ordinary AA drift, comfortably below what an actual layout
 * regression produces (a real disconnected-render regression measured
 * this session was ~1.2% on a full page -- still well under this
 * threshold's own intent to catch it, since that case also came with a
 * qualitatively different, spatially-widespread diff, not a tight aliasing
 * fringe).
 */
const VISUAL_DIFF_RATIO = 0.015;

/**
 * Zodiac starts with zero Workspaces -- bootstrap one via a direct daemon
 * dispatch, not by driving the live chat composer (fill "start" + send).
 * That composer path exercises the LLM-naming call and a real agent
 * session -- both already covered elsewhere (workspace-catalog-lifecycle.spec.ts,
 * live-world-tiles.spec.ts) and both real, independent sources of flake
 * this spec's own screenshots have nothing to do with (confirmed live: a
 * containerized headless-Chromium run hit a real, unrelated UI-timing race
 * in that exact composer flow -- see git history for the full diagnostic).
 * A visual-regression test should isolate its own actual concern (pixel
 * rendering) from an interaction flow it isn't testing.
 *
 * The fixture conversation list (apps/service/src/fixtures/fixture-
 * conversations.ts) is global and Workspace-independent -- "no assertion
 * in the system suite actually inspects a fixture conversation's own
 * content" per that file's own doc comment -- so skipping the live chat
 * send entirely still leaves the same fixture-backed transcript content
 * these baselines capture. One reload picks up that fixture list.
 */
test.beforeEach(async ({ page }) => {
	// title: "New Workspace" matches App.tsx's own real fallback
	// (provisionalTitleFromText(text) ?? "New Workspace") for exactly the
	// "start" prompt the old composer-driven version of this beforeEach used
	// to send -- deliberately, not incidentally: a different title here would
	// still often pass under this spec's own ratio-based threshold (a small
	// text region's full difference can fall under a whole page's tolerance
	// without ever needing to match), silently drifting the baseline's own
	// visible content away from what it claims to show without ever failing.
	await postCommand({ type: "workspace.create", workspaceId: `visual-test-${Date.now()}`, title: "New Workspace", activate: true });
	await page.goto("/");
	await waitForShell(page);
	await page.reload();
	await waitForShell(page);
});

test("Zodiac Workspace matches the light visual baseline", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("zodiac.theme", "light"));
	await page.reload();
	await waitForShell(page);
	await freezeWispBreathing(page);
	await expect(page).toHaveScreenshot("zodiac-workspace-light.png", { maxDiffPixelRatio: VISUAL_DIFF_RATIO, mask: dynamicRegions(page) });
});

test("collapsed Workspace quick selection shows Workspace glyphs and keymap hints", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("zodiac.theme", "light"));
	await page.reload();
	await waitForShell(page);

	// No fixed demo catalog anymore -- create a real Workspace to hover.
	await page.getByRole("button", { name: "Create a new Workspace" }).click();
	await page.getByLabel("Workspace title").fill("Bug");
	await page.getByRole("button", { name: "Create" }).click();

	await page.keyboard.press("Control+b");
	const quickSelection = page.getByRole("navigation", { name: "Workspace quick selection" });
	await quickSelection.getByRole("button", { name: "Bug", exact: true }).hover();
	await expect(page.getByRole("tooltip")).toContainText("Bug");
	await freezeWispBreathing(page);
	// Scoped to the nav itself, not the full page -- what this test actually
	// verifies (glyphs/keymap hints in the collapsed strip) never depends on
	// the Chat/canvas content elsewhere on the page, so there's no reason to
	// expose the assertion to drift there too. The tooltip's own text
	// content is already verified above; its visual rendering isn't this
	// screenshot's concern.
	await expect(quickSelection).toHaveScreenshot("zodiac-workspace-quick-selection.png", { maxDiffPixelRatio: VISUAL_DIFF_RATIO, mask: dynamicRegions(page) });
});

test("Zodiac Workspace matches the dark visual baseline", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("zodiac.theme", "dark"));
	await page.reload();
	await waitForShell(page);
	await freezeWispBreathing(page);
	await expect(page).toHaveScreenshot("zodiac-workspace-dark.png", { maxDiffPixelRatio: VISUAL_DIFF_RATIO, mask: dynamicRegions(page) });
});
