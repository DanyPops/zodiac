import { expect, test } from "@playwright/test";

async function waitForShell(page: import("@playwright/test").Page): Promise<void> {
	await expect(page.getByRole("navigation", { name: "Window Carousel" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await waitForShell(page);
});

test("Alignment Workspace matches the light visual baseline", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("alignment.theme", "light"));
	await page.reload();
	await waitForShell(page);
	await expect(page).toHaveScreenshot("alignment-workspace-light.png", { maxDiffPixels: 20 });
});

test("collapsed Workspace quick selection shows conversation and keymap hints", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("alignment.theme", "light"));
	await page.reload();
	await waitForShell(page);
	await page.keyboard.press("Control+b");
	const quickSelection = page.getByRole("navigation", { name: "Workspace quick selection" });
	await quickSelection.getByRole("button", { name: "Fixture conversation", exact: true }).hover();
	await expect(page.getByRole("tooltip")).toContainText("Fixture conversation");
	await expect(page).toHaveScreenshot("alignment-workspace-quick-selection.png", { maxDiffPixels: 20 });
});

test("Alignment Workspace matches the dark visual baseline", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("alignment.theme", "dark"));
	await page.reload();
	await waitForShell(page);
	await expect(page).toHaveScreenshot("alignment-workspace-dark.png", { maxDiffPixels: 20 });
});
