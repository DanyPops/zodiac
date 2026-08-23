import { expect, test } from "@playwright/test";

/**
 * Pre-migration baseline for the workspace-authority cutover (see the "Cut the primary
 * React workspace shell over" task tree). Confirmed gap before writing this: 77 existing
 * unit tests (model.test.ts/useWorkspaceRegistry.test.ts/useUserWorkspaces.test.ts) and
 * workspace-slice.spec.ts already characterize every Window/Surface behavior in detail,
 * but nothing exercises the Workspace *catalog* lifecycle (create/rename/remove/select)
 * through App.tsx's real userWorkspaces+workspace two-layer wiring -- CreateWorkspaceDialog.test.tsx
 * only tests the dialog component in isolation with a mocked onCreate.
 *
 * This spec must keep passing unchanged against today's local-mock implementation, and
 * must keep passing (rewritten only at the seams that genuinely change -- id source,
 * network round trips) once the daemon-backed cutover lands, per the migration's own
 * "characterize before cutover" ordering.
 */

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Zodiac", exact: true })).toBeVisible();
});

test("creating a Workspace adds it to the catalog, selected, with the chosen title and glyph", async ({ page }) => {
	await page.getByRole("button", { name: "Create a new Workspace" }).click();

	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByLabel("Workspace title").fill("Deploys");
	await dialog.getByRole("radio", { name: "rocket" }).click();
	await dialog.getByRole("button", { name: "Create" }).click();

	await expect(dialog).toBeHidden();
	const created = page.getByRole("button", { name: "Deploys", exact: true });
	await expect(created).toBeVisible();
	await expect(created).toHaveAttribute("aria-current", "page");
});

test("renaming a Workspace via double-click updates the catalog label live", async ({ page }) => {
	await page.getByRole("button", { name: "Create a new Workspace" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Workspace title").fill("Original Title");
	await dialog.getByRole("button", { name: "Create" }).click();
	await expect(dialog).toBeHidden();

	const row = page.getByRole("button", { name: "Original Title", exact: true });
	await row.dblclick();
	const renameInput = page.getByLabel("Rename Original Title");
	await expect(renameInput).toBeVisible();
	await renameInput.fill("Renamed Title");
	await renameInput.press("Enter");

	await expect(page.getByRole("button", { name: "Renamed Title", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Original Title", exact: true })).toHaveCount(0);
});

test("selecting a different Workspace in the catalog switches the active one", async ({ page }) => {
	await page.getByRole("button", { name: "Create a new Workspace" }).click();
	await page.getByRole("dialog").getByLabel("Workspace title").fill("First Workspace");
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
	await expect(page.getByRole("dialog")).toBeHidden();

	await page.getByRole("button", { name: "Create a new Workspace" }).click();
	await page.getByRole("dialog").getByLabel("Workspace title").fill("Second Workspace");
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
	await expect(page.getByRole("dialog")).toBeHidden();

	const first = page.getByRole("button", { name: "First Workspace", exact: true });
	const second = page.getByRole("button", { name: "Second Workspace", exact: true });
	await expect(second).toHaveAttribute("aria-current", "page");
	await expect(first).not.toHaveAttribute("aria-current", "page");

	await first.click();
	await expect(first).toHaveAttribute("aria-current", "page");
	await expect(second).not.toHaveAttribute("aria-current", "page");
});

test("removing a Workspace requires confirmation, then drops it from the catalog", async ({ page }) => {
	await page.getByRole("button", { name: "Create a new Workspace" }).click();
	await page.getByRole("dialog").getByLabel("Workspace title").fill("Disposable");
	await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
	await expect(page.getByRole("dialog")).toBeHidden();

	const row = page.getByRole("button", { name: "Disposable", exact: true });
	await expect(row).toBeVisible();
	await row.hover();
	await page.getByRole("button", { name: "Close Disposable" }).click();

	const confirm = page.getByRole("alertdialog", { name: "Close Disposable?" });
	await expect(confirm).toBeVisible();
	await confirm.getByRole("button", { name: "Close Workspace" }).click();

	await expect(page.getByRole("button", { name: "Disposable", exact: true })).toHaveCount(0);
});
