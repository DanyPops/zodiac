import { expect, test } from "@playwright/test";

async function waitForConversation(page: import("@playwright/test").Page): Promise<void> {
	await expect(page.getByRole("log", { name: "AI conversation" })).toContainText("Please read the readme");
}

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await waitForConversation(page);
});

test("Alignment Workspace matches the light visual baseline", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("alignment.theme", "light"));
	await page.reload();
	await waitForConversation(page);
	await expect(page).toHaveScreenshot("alignment-workspace-light.png", { maxDiffPixels: 20 });
});

test("collapsed Workspace quick selection shows domain and keymap hints", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("alignment.theme", "light"));
	await page.reload();
	await waitForConversation(page);
	await page.keyboard.press("Control+b");
	const quickSelection = page.getByRole("navigation", { name: "Workspace quick selection" });
	await quickSelection.getByRole("button", { name: "Conversation" }).hover();
	await expect(page.getByRole("tooltip")).toContainText("Ctrl+Shift+[");
	await expect(page).toHaveScreenshot("alignment-workspace-quick-selection.png", { maxDiffPixels: 20 });
});

test("Alignment Workspace matches the dark visual baseline", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("alignment.theme", "dark"));
	await page.reload();
	await waitForConversation(page);
	await expect(page).toHaveScreenshot("alignment-workspace-dark.png", { maxDiffPixels: 20 });
});
