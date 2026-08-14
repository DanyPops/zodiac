import { expect, test, type Page } from "@playwright/test";

/** The live clock ticks during a real test run -- mask it out of every screenshot rather than compare its digits, which flakes on a minute boundary. */
function dynamicRegions(page: Page) {
	return [page.getByRole("status", { name: "Current time" })];
}

async function waitForShell(page: import("@playwright/test").Page): Promise<void> {
	await expect(page.getByRole("navigation", { name: "Window Carousel" })).toBeVisible();
}

// Zodiac starts with zero Workspaces -- bootstrap one, then reload once so the
// baselines capture the fixture-backed historical conversation (session-sample.jsonl),
// not the live "start" exchange this bootstrap itself just sent.
test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await page.getByRole("textbox", { name: "Message Pi" }).fill("start");
	await page.getByRole("button", { name: "Send message" }).click();
	await waitForShell(page);
	await page.reload();
	await waitForShell(page);
});

test("Zodiac Workspace matches the light visual baseline", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("zodiac.theme", "light"));
	await page.reload();
	await waitForShell(page);
	await expect(page).toHaveScreenshot("zodiac-workspace-light.png", { maxDiffPixels: 20, mask: dynamicRegions(page) });
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
	await expect(page).toHaveScreenshot("zodiac-workspace-quick-selection.png", { maxDiffPixels: 20, mask: dynamicRegions(page) });
});

test("Zodiac Workspace matches the dark visual baseline", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("zodiac.theme", "dark"));
	await page.reload();
	await waitForShell(page);
	await expect(page).toHaveScreenshot("zodiac-workspace-dark.png", { maxDiffPixels: 20, mask: dynamicRegions(page) });
});
