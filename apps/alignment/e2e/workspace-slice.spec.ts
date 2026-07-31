import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Alignment", exact: true })).toBeVisible();
	await expect(page.getByRole("log", { name: "AI conversation" })).toContainText("Please read the readme");
});

test("renders the Alignment Workspace with a real conversation and parent-attached child tabs", async ({ page }) => {
	await expect(page).toHaveTitle("Alignment");
	await expect(page.getByRole("navigation", { name: "Workspace selection" })).toBeVisible();
	await expect(page.getByRole("main", { name: "Workspace canvas" })).toBeVisible();
	await expect(page.getByRole("region", { name: "Chat surface" })).toBeVisible();
	await expect(page.getByText("Fixture preview — Alef write path is not connected.", { exact: true })).toBeVisible();

	const tabs = page.getByRole("tablist", { name: "Chat surface views" });
	await expect(tabs.getByRole("tab", { name: "Conversation" })).toHaveAttribute("aria-selected", "true");
	await tabs.getByRole("tab", { name: "Activity" }).click();
	await expect(page.getByRole("tabpanel", { name: "Activity" })).toContainText("Workspace activity");
	await expect(page.getByRole("tabpanel", { name: "Conversation" })).toBeHidden();
});

test("all shell actions share command bindings and expose them on hover and focus", async ({ page }) => {
	const toggle = page.getByRole("button", { name: "Hide workspace selection" });
	await expect(toggle).toHaveAttribute("aria-keyshortcuts", "Control+B");

	await toggle.hover();
	const tooltip = page.getByRole("tooltip");
	await expect(tooltip).toContainText("Hide workspace selection");
	await expect(tooltip.locator("kbd")).toContainText("Ctrl+B");

	await page.keyboard.press("Control+b");
	await expect(page.getByRole("navigation", { name: "Workspace selection" })).toBeHidden();
	const quickSelection = page.getByRole("navigation", { name: "Workspace quick selection" });
	await expect(quickSelection).toBeVisible();
	const collapsedToggle = quickSelection.getByRole("button", { name: "Expand workspace selection" });
	const logoBox = await collapsedToggle.boundingBox();
	expect(logoBox?.height).toBe(48);
	await collapsedToggle.hover();
	await expect(page.getByRole("tooltip")).toContainText("Expand workspace selection");
	await expect(page.getByRole("tooltip").locator("kbd")).toContainText("Ctrl+B");
	const conversationGlyph = quickSelection.getByRole("button", { name: "Conversation" });
	await conversationGlyph.hover();
	await expect(page.getByRole("tooltip")).toContainText("Conversation");
	await expect(page.getByRole("tooltip").locator("kbd")).toContainText("Ctrl+Shift+[");
	await quickSelection.getByRole("button", { name: "Activity" }).click();
	await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");

	await page.keyboard.press("Control+b");
	await expect(page.getByRole("navigation", { name: "Workspace selection" })).toBeVisible();
});

test("keyboard-only flow reaches selection, canvas, nested tabs, composer, theme, palette, and shortcut help", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("alignment.theme", "light"));
	await page.reload();
	await expect(page.getByRole("log", { name: "AI conversation" })).toContainText("Please read the readme");

	await page.keyboard.press("Control+1");
	await expect(page.getByRole("navigation", { name: "Workspace selection" })).toContainText("Fixture conversation");
	await expect(page.getByRole("button", { name: /^Fixture conversation/ })).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(page.getByRole("button", { name: /^Secondary fixture conversation/ })).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(page.getByRole("button", { name: /^Fixture conversation/ })).toBeFocused();

	await page.keyboard.press("Control+2");
	await expect(page.getByRole("region", { name: "Chat surface" })).toBeFocused();

	await page.keyboard.press("Control+Shift+]");
	await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("Control+Shift+[");
	await expect(page.getByRole("tab", { name: "Conversation" })).toHaveAttribute("aria-selected", "true");

	await page.getByRole("textbox", { name: "Message Alef" }).fill("Run the first slice");
	await page.keyboard.press("Control+Enter");
	await expect(page.getByRole("log", { name: "AI conversation" })).toContainText("Run the first slice");
	await expect(page.getByRole("textbox", { name: "Message Alef" })).toHaveValue("");

	await expect(page.getByRole("button", { name: "Cycle color theme" })).toHaveAttribute("aria-keyshortcuts", "Control+Alt+L");
	await page.keyboard.press("Control+Alt+L");
	expect(await page.evaluate(() => localStorage.getItem("alignment.theme"))).toBe("dark");
	await expect(page.locator("html")).toHaveClass(/dark/);

	await page.keyboard.press("Control+k");
	await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
	await expect(page.getByRole("dialog", { name: "Command palette" })).toContainText("Toggle workspace selection");
	await expect(page.getByRole("dialog", { name: "Command palette" })).toContainText("Ctrl+B");
	await page.keyboard.press("Escape");

	await page.keyboard.press("Control+/");
	await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
	await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText("Focus workspace canvas");
});

test("a user can rebind a command and the override survives reload", async ({ page }) => {
	await page.keyboard.press("Control+/");
	await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
	await page.getByRole("button", { name: "Change shortcut for Open command palette" }).click();
	await page.keyboard.press("Control+P");
	await expect(page.getByRole("button", { name: "Change shortcut for Open command palette" })).toContainText("Ctrl+P");
	await page.keyboard.press("Escape");

	await page.keyboard.press("Control+P");
	await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.reload();
	await expect(page.getByRole("log", { name: "AI conversation" })).toContainText("Please read the readme");
	await expect(page.getByRole("button", { name: "Command palette" })).toHaveAttribute("aria-keyshortcuts", "Control+P");
	await page.keyboard.press("Control+P");
	await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

test("printable global shortcuts do not steal text input", async ({ page }) => {
	const composer = page.getByRole("textbox", { name: "Message Alef" });
	await composer.fill("b k / [ ]");
	await page.keyboard.type(" ordinary typing");
	await expect(composer).toHaveValue("b k / [ ] ordinary typing");
});

test("the first slice has no serious or critical automated accessibility violations", async ({ page }) => {
	const results = await new AxeBuilder({ page }).analyze();
	const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
	expect(blocking).toEqual([]);
});

test("the canvas remains usable at a narrow viewport after keyboard-collapsing selection", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.keyboard.press("Control+b");
	await expect(page.getByRole("navigation", { name: "Workspace selection" })).toBeHidden();
	await expect(page.getByRole("navigation", { name: "Workspace quick selection" })).toBeVisible();
	const canvas = await page.getByRole("region", { name: "Chat surface" }).boundingBox();
	expect(canvas?.width).toBeGreaterThan(300);
});

test("browser APIs expose opaque conversation identity, not filesystem paths", async ({ request }) => {
	const conversationsResponse = await request.get("/api/conversations");
	expect(conversationsResponse.ok()).toBe(true);
	const conversationsBody = await conversationsResponse.text();
	expect(conversationsBody).not.toContain("filePath");
	expect(conversationsBody).not.toContain("session-sample.jsonl");

	const missingIdResponse = await request.get("/api/events");
	expect(missingIdResponse.status()).toBe(400);
	expect(await missingIdResponse.json()).toMatchObject({ code: "conversation-id-required" });

	// conversationId is looked up in a pre-built map, never joined onto a
	// filesystem path -- a traversal-shaped id must resolve like any other
	// unknown id (404), not read an arbitrary file.
	for (const traversalId of ["../../../../etc/passwd", "/etc/passwd", "..%2f..%2fetc%2fpasswd"]) {
		const traversalResponse = await request.get(`/api/events?conversationId=${encodeURIComponent(traversalId)}`);
		expect(traversalResponse.status()).toBe(404);
		expect(await traversalResponse.json()).toMatchObject({ code: "conversation-not-found" });
	}
});

test("legacy product storage migrates without losing preferences", async ({ page }) => {
	await page.evaluate(() => {
		localStorage.clear();
		localStorage.setItem("agent-deck-theme", "dark");
		localStorage.setItem("agent-deck-sidebar-collapsed", "true");
		localStorage.setItem("agent-deck-dashboard-layout", '{"schemaVersion":1,"panels":[]}');
	});
	await page.reload();

	await expect(page.locator("html")).toHaveClass(/dark/);
	await expect(page.getByRole("navigation", { name: "Workspace selection" })).toBeHidden();
	await expect(page.getByRole("navigation", { name: "Workspace quick selection" })).toBeVisible();
	const migrated = await page.evaluate(() => ({
		theme: localStorage.getItem("alignment.theme"),
		selection: localStorage.getItem("alignment.workspace-selection-collapsed"),
		legacyLayout: localStorage.getItem("alignment.workspace-layout.legacy-v1"),
	}));
	expect(migrated).toEqual({ theme: "dark", selection: "true", legacyLayout: '{"schemaVersion":1,"panels":[]}' });
});
