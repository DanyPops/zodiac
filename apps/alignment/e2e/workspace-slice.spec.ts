import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Alignment", exact: true })).toBeVisible();
	await expect(page.getByRole("navigation", { name: "Window Carousel" })).toBeVisible();
});

async function revealChat(page: Page): Promise<void> {
	await page.keyboard.press("Control+.");
	await expect(page.getByRole("dialog", { name: "Chat" })).toBeVisible();
}

/** Mock Workspaces start pre-seeded with several demo Windows (workspace-catalog.ts's createDemoWorkspace) -- tests read the real starting count/active index off the DOM rather than assuming "one Window at index 0". */
function windowButtons(carousel: Locator): Locator {
	return carousel.getByRole("button", { name: /^\d+$/ });
}

async function activeWindowIndex(carousel: Locator): Promise<number> {
	const label = await carousel.locator('[aria-current="true"]').innerText();
	return Number(label);
}

test("Chat is a hidden-by-default floating overlay, summoned by keymap or the bottom edge", async ({ page }) => {
	// Hidden by default: inert removes it from the accessibility tree entirely.
	await expect(page.getByRole("dialog", { name: "Chat" })).toHaveCount(0);

	await revealChat(page);
	// Starts collapsed (peek): only the last reply, not the full transcript.
	await expect(page.getByText("You're welcome!")).toBeVisible();
	await expect(page.getByText("Please read the readme")).toHaveCount(0);

	// The keymap toggles: pressing it again hides Chat.
	await page.keyboard.press("Control+.");
	await expect(page.getByRole("dialog", { name: "Chat" })).toHaveCount(0);

	// Bottom-edge hover reveals it without the keymap.
	const viewport = page.viewportSize();
	await page.mouse.move(viewport!.width / 2, viewport!.height - 2);
	await expect(page.getByRole("dialog", { name: "Chat" })).toBeVisible();
});

test("clicking the Chat peek area expands to the full transcript", async ({ page }) => {
	await revealChat(page);
	await page.getByRole("button", { name: "Expand chat to the full conversation" }).click();
	await expect(page.getByRole("log", { name: "AI conversation" })).toContainText("Please read the readme");
	await expect(page.getByRole("log", { name: "AI conversation" })).toContainText("You're welcome!");

	await page.getByRole("button", { name: "Collapse to the last reply" }).click();
	await expect(page.getByRole("log", { name: "AI conversation" })).toHaveCount(0);
	await expect(page.getByText("You're welcome!")).toBeVisible();
});

test("Chat auto-hides after inactivity once unfocused and un-hovered", async ({ page }) => {
	await revealChat(page);
	await page.mouse.move(400, 200); // away from the panel and the bottom edge
	await expect(page.getByRole("dialog", { name: "Chat" })).toHaveCount(0, { timeout: 4000 });
});

test("Chat is dockable: docking it hides the floating overlay, and it becomes aware of its sibling docked Surfaces", async ({ page }) => {
	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();
	await expect(page.getByText("Workspace activity")).toBeVisible();

	await revealChat(page);
	await page.getByRole("button", { name: "Dock Chat into the active Window" }).click();

	// The floating overlay is gone -- Chat now lives in the Window as a docked panel.
	await expect(page.getByRole("dialog", { name: "Chat" })).toHaveCount(0);
	await expect(page.getByText("Aware of: Activity")).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Message Alef" })).toBeVisible();
});

test("undocking Chat (the Float control) returns it to the floating overlay", async ({ page }) => {
	await revealChat(page);
	await page.getByRole("button", { name: "Dock Chat into the active Window" }).click();
	await expect(page.getByText("Aware of: nothing else docked here")).toBeVisible();

	await page.getByRole("button", { name: "Undock Chat back to the floating overlay" }).click();
	await expect(page.getByRole("dialog", { name: "Chat" })).toBeVisible();
	await expect(page.getByText("Aware of:")).toHaveCount(0);
});

test("the Window Carousel starts with several mock Windows, centered and fading with distance, and an empty docking watermark", async ({ page }) => {
	const carousel = page.getByRole("navigation", { name: "Window Carousel" });
	const buttons = windowButtons(carousel);
	const count = await buttons.count();
	expect(count).toBeGreaterThan(4); // enough mock Windows either side of center to see the fade

	const activeIndex = await activeWindowIndex(carousel);
	expect(activeIndex).toBe(Math.floor(count / 2)); // the active Window starts centered, not first
	await expect(buttons.nth(activeIndex)).toHaveCSS("opacity", "1");
	// Far enough from center that window-carousel-fade.ts's falloff clamps to fully invisible.
	await expect(buttons.first()).toHaveCSS("opacity", "0");
	await expect(buttons.last()).toHaveCSS("opacity", "0");

	await expect(page.getByText("Pull a Surface Template from the right pillar to dock it here.")).toBeVisible();
});

test("the Window Carousel is an infinite loop: the Window right before the first is the last one, not maximally far away", async ({ page }) => {
	const carousel = page.getByRole("navigation", { name: "Window Carousel" });
	const buttons = windowButtons(carousel);
	const count = await buttons.count();
	const lastIndex = count - 1;

	await buttons.nth(0).click();
	await expect(carousel.getByRole("button", { name: "0" })).toHaveAttribute("aria-current", "true");
	await expect(buttons.nth(0)).toHaveCSS("opacity", "1");
	const lastOpacity = Number(await buttons.nth(lastIndex).evaluate((element) => getComputedStyle(element).opacity));
	const secondOpacity = Number(await buttons.nth(1).evaluate((element) => getComputedStyle(element).opacity));
	expect(lastOpacity).toBeGreaterThan(0); // visible, not faded into nothing
	expect(lastOpacity).toBeCloseTo(secondOpacity, 5); // symmetric: one step away on either side of 0

	await buttons.nth(lastIndex).click();
	await page.getByRole("button", { name: "Next Window" }).click();
	await expect(carousel.getByRole("button", { name: "0" })).toHaveAttribute("aria-current", "true");
});

test("a real mouse wheel scroll over the Window Carousel moves exactly one Window, without disturbing the others", async ({ page }) => {
	const carousel = page.getByRole("navigation", { name: "Window Carousel" });
	const originalCount = await windowButtons(carousel).count();
	const startIndex = await activeWindowIndex(carousel);

	// A real physical scroll: move the mouse first, then wheel -- not a
	// locator-scoped synthetic dispatch.
	const box = (await carousel.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.wheel(0, 50);

	await expect(carousel.getByRole("button", { name: String(startIndex + 1) })).toHaveAttribute("aria-current", "true");
	await expect(windowButtons(carousel)).toHaveCount(originalCount); // moving within existing Windows disturbs nothing
});

test("a burst of small, rapid wheel events (a real trackpad gesture) never triggers a passive-listener preventDefault error", async ({ page }) => {
	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});

	const carousel = page.getByRole("navigation", { name: "Window Carousel" });
	const box = (await carousel.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 4); // small deltas, no waits

	expect(consoleErrors.filter((text) => text.includes("preventDefault"))).toEqual([]);
});

test("clicking a Surface Template glyph docks it into the active Window", async ({ page }) => {
	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();
	await expect(page.getByText("Workspace activity")).toBeVisible();
});

test("Window Carousel: clicking a Window index switches to an independent docking arrangement", async ({ page }) => {
	const carousel = page.getByRole("navigation", { name: "Window Carousel" });
	const originalActiveIndex = await activeWindowIndex(carousel);
	const originalCount = await windowButtons(carousel).count();

	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();
	await expect(page.getByText("Workspace activity")).toBeVisible();

	await page.getByRole("button", { name: "New Window" }).click(); // appends at the end -- a fresh index equal to the previous count
	await expect(carousel.getByRole("button", { name: String(originalCount) })).toHaveAttribute("aria-current", "true");
	await expect(page.getByText("Pull a Surface Template from the right pillar to dock it here.")).toBeVisible();
	await expect(page.getByText("Workspace activity")).toBeHidden();

	await carousel.getByRole("button", { name: String(originalActiveIndex) }).click();
	await expect(page.getByText("Workspace activity")).toBeVisible();
});

test("wheel-scrolling forward past the last Window wraps to the first, without creating or pruning any Window", async ({ page }) => {
	const carousel = page.getByRole("navigation", { name: "Window Carousel" });
	const originalCount = await windowButtons(carousel).count();
	const lastMockIndex = originalCount - 1;
	await carousel.getByRole("button", { name: String(lastMockIndex) }).click();
	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();
	await expect(page.getByText("Workspace activity")).toBeVisible();

	await carousel.hover();
	await page.mouse.wheel(0, 100); // forward, past the last Window -- wraps to the first, nothing created or pruned
	await expect(windowButtons(carousel)).toHaveCount(originalCount);
	await expect(carousel.getByRole("button", { name: "0" })).toHaveAttribute("aria-current", "true");

	await page.mouse.wheel(0, -100); // backward from the first -- wraps back to the last (still docked) Window
	await expect(windowButtons(carousel)).toHaveCount(originalCount);
	await expect(carousel.getByRole("button", { name: String(lastMockIndex) })).toHaveAttribute("aria-current", "true");
	await expect(page.getByText("Workspace activity")).toBeVisible();
});

test("the Surface Templates keyboard flow: filter, select, and choose a placement", async ({ page }) => {
	await page.keyboard.press("Control+Shift+K");
	await expect(page.getByRole("dialog", { name: "Surface Templates" })).toBeVisible();

	await page.getByLabel("Filter Surface Templates").fill("Activity");
	await page.getByRole("button", { name: "Activity", exact: true }).click();
	await expect(page.getByText('Dock "Activity"')).toBeVisible();

	await page.getByRole("button", { name: "Split right" }).click();
	await expect(page.getByRole("dialog", { name: "Surface Templates" })).toHaveCount(0);
	await expect(page.getByText("Workspace activity")).toBeVisible();
});

test("saving the active docked Surface as a template adds it to the pillar", async ({ page }) => {
	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();
	await expect(page.getByText("Workspace activity")).toBeVisible();

	await page.getByRole("button", { name: "Save the active docked Surface as a new template" }).click();
	await page.getByLabel("New template title").fill("My Activity View");
	await page.getByRole("button", { name: "Save" }).click();

	await expect(page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock My Activity View" })).toBeVisible();

	await page.reload();
	await expect(page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock My Activity View" })).toBeVisible();
});

test("the gear icon opens Visual DNA: moving a slider re-styles the shell live and survives reload", async ({ page }) => {
	// A plain CSS locator, not getByRole: Radix's Dialog marks background
	// content aria-hidden while open, which would make an ARIA-role query for
	// the Carousel time out even though it's still rendered and stylable.
	const carousel = page.locator('[aria-label="Window Carousel"]');
	const cornerRadiusBefore = await carousel.evaluate((element) => getComputedStyle(element).borderRadius);

	await page.getByRole("button", { name: "Visual DNA" }).click();
	const dialog = page.getByRole("dialog", { name: "Visual DNA" });
	await expect(dialog).toBeVisible();

	// Square end of the slider: the Window Carousel (part of the same shared
	// rounded-corner language as docked Surfaces and both pillars) goes flush.
	await dialog.getByLabel("Corner Sharpness").fill("0");
	await expect(carousel).toHaveCSS("border-radius", "0px");

	await page.getByRole("button", { name: "Close Visual DNA" }).click();
	await expect(dialog).not.toBeVisible();

	// Persisted, not just an in-memory slider position.
	await page.reload();
	await expect(carousel).toHaveCSS("border-radius", "0px");
	expect(cornerRadiusBefore).not.toBe("0px");
});

test("dragging a Surface Template from the pillar onto the empty Window docks it", async ({ page }) => {
	// Playwright's documented pattern for native HTML5 DnD (mouse-based
	// dragTo() doesn't fire real drag events, which is what both the pillar's
	// draggable glyph and dockview-core's own html5Backend rely on): build one
	// DataTransfer in-page and dispatch the same reference through the whole
	// dragstart -> dragenter -> dragover -> drop sequence.
	const glyph = page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" });
	// dockview-core's own drop-target listener is attached to its root grid
	// element (`.dv-dockview`), several DOM levels below the "Window view"
	// region -- dragenter/dragover/drop only bubble upward from where they're
	// dispatched, so targeting the outer region would never reach it.
	const target = page.locator(".dv-dockview");

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await target.dispatchEvent("dragenter", { dataTransfer });
	// Two samples at the same (implicit) position: the debounce policy needs a
	// confirmed low-velocity comparison before accepting a drop target at all,
	// which any real drag satisfies (a native drag fires dragover continuously
	// while hovering, even for a near-instant release) but a single synthetic
	// dragover does not.
	await target.dispatchEvent("dragover", { dataTransfer });
	await target.dispatchEvent("dragover", { dataTransfer });
	await target.dispatchEvent("drop", { dataTransfer });
	await glyph.dispatchEvent("dragend", { dataTransfer });

	await expect(page.getByText("Workspace activity")).toBeVisible();
});

test("dragging a template onto the left edge of an already-docked Surface splits the Window", async ({ page }) => {
	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();
	await expect(page.getByText("Workspace activity")).toBeVisible();
	await expect(page.locator(".dv-groupview")).toHaveCount(1);

	const glyph = page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" });
	const target = page.locator(".dv-dockview");
	const box = (await target.boundingBox())!;
	// Within the root drop target's edge activation band (10px by default) --
	// see calculateQuadrantAsPixels/DEFAULT_ROOT_OVERLAY_MODEL in dockview-core.
	const edgeX = box.x + 5;
	const midY = box.y + box.height / 2;

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await target.dispatchEvent("dragenter", { dataTransfer, clientX: edgeX, clientY: midY });
	// Two samples at the same position: the debounce policy requires a
	// confirmed low-velocity comparison before showing anything, so a real
	// (if brief) hover -- which fires several native dragover events even
	// without the pointer moving -- is what a single unbroken dragover
	// never is.
	await target.dispatchEvent("dragover", { dataTransfer, clientX: edgeX, clientY: midY });
	await target.dispatchEvent("dragover", { dataTransfer, clientX: edgeX, clientY: midY });
	await expect(page.locator(".dv-drop-target-edge, .dv-drop-target-selection, .dv-drop-target-dropzone").first()).toBeVisible(); // the split preview overlay is showing before release
	await target.dispatchEvent("drop", { dataTransfer, clientX: edgeX, clientY: midY });
	await glyph.dispatchEvent("dragend", { dataTransfer });

	const groups = page.locator(".dv-groupview");
	await expect(groups).toHaveCount(2);
	const [leftBox, rightBox] = await Promise.all([groups.nth(0).boundingBox(), groups.nth(1).boundingBox()]);
	expect(leftBox!.x).toBeLessThan(rightBox!.x); // genuinely a left/right split, not two stacked or tabbed panels
});

test("Dock Ruler: the frame appears the moment a Surface Template drag starts and wraps the dock area, not just while hovering a drop target", async ({ page }) => {
	const glyph = page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" });
	const canvas = page.getByRole("region", { name: "Window view" });
	const canvasBox = (await canvas.boundingBox())!;

	await expect(page.getByTestId("dock-ruler")).toBeHidden();

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	// Still over the pillar itself, nowhere near the dock canvas -- the frame's
	// own visibility is driven by "a drag is active", not by hovering content.
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await expect(page.getByTestId("dock-ruler")).toBeVisible();

	const bars = page.getByTestId("dock-ruler-bar");
	await expect(bars).toHaveCount(4);
	const boxes = await bars.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
	// Every bar sits outside the canvas's own box on its own edge -- above,
	// below, left, or right of it -- never overlapping the canvas interior.
	const outside = boxes.some((box) => Math.abs(box.top + box.height - canvasBox.y) < 2) && boxes.some((box) => Math.abs(box.top - (canvasBox.y + canvasBox.height)) < 2);
	expect(outside).toBe(true);

	await glyph.dispatchEvent("dragend", { dataTransfer });
	await expect(page.getByTestId("dock-ruler")).toBeHidden();
});

test("Dock Ruler frame is a pure visual overlay -- it must never win real hit-testing over the dock canvas mid-drag", async ({ page }) => {
	// Regression test for a real degradation: element.dispatchEvent() (used by
	// every other drag test in this file, for good reason -- see the
	// .dv-content-container comment below) fires directly on a named element
	// regardless of what's visually on top of it, so it can't catch a drop
	// silently being swallowed by an invisible full-viewport layer. A real
	// browser resolves drag/drop targets via genuine hit-testing (whatever
	// element is topmost at the pointer), which document.elementFromPoint
	// exercises the same way without fighting Playwright's own unreliable
	// native HTML5 drag simulation.
	const glyph = page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" });
	const canvas = page.getByRole("region", { name: "Window view" });
	const box = (await canvas.boundingBox())!;
	const centerX = box.x + box.width / 2;
	const centerY = box.y + box.height / 2;

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await expect(page.getByTestId("dock-ruler")).toBeVisible();

	const hit = await page.evaluate(
		([x, y]) => {
			const element = document.elementFromPoint(x, y);
			return element?.getAttribute("data-testid") ?? null;
		},
		[centerX, centerY] as const,
	);
	// The frame wraps the canvas from the outside -- real hit-testing at the
	// canvas's own center must resolve to the dockview content underneath it,
	// never to the frame's own wrapper or one of its bars.
	expect(hit).not.toBe("dock-ruler");
	expect(hit).not.toBe("dock-ruler-bar");

	await glyph.dispatchEvent("dragend", { dataTransfer });
});

test("Dock Ruler: dragging well inside an already-docked Surface (not the thin root-edge band) shows a granular fraction guide", async ({ page }) => {
	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();
	await expect(page.getByText("Workspace activity")).toBeVisible();

	const glyph = page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" });
	// dockview's per-group content dropTarget is bound to .dv-content-container,
	// a descendant of .dv-dockview -- native drag events only bubble upward from
	// their real dispatch target, so dispatching on the outer .dv-dockview (as
	// the coarse root-edge test above does) never reaches it.
	const content = page.locator(".dv-content-container");
	const box = (await content.boundingBox())!;
	// A quarter of the way across -- comfortably inside the group's own
	// content area, past the thin (10px) root-edge band that rootDropTargetService
	// owns separately (see the coarse edge-split test above, unaffected by the
	// Dock Ruler by design -- a fast "split roughly in half" gesture still works).
	const quarterX = box.x + box.width / 4;
	const midY = box.y + box.height / 2;

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await content.dispatchEvent("dragenter", { dataTransfer, clientX: quarterX, clientY: midY });
	await content.dispatchEvent("dragover", { dataTransfer, clientX: quarterX, clientY: midY });

	// The ruler tracks live -- no settle/debounce needed, unlike the root-edge case.
	// The frame wraps the dock area with two bars per axis (above/below the
	// canvas) -- both show the same live label, not drawn over the content itself.
	await expect(page.getByTestId("dock-ruler")).toBeVisible();
	await expect(page.getByText("1/4").first()).toBeVisible();
	expect(await page.getByText("1/4").count()).toBe(2);
	// Dockview's own coarse overlay is superseded, not just visually covered.
	await expect(page.locator(".dv-drop-target-dropzone")).toBeHidden();

	await content.dispatchEvent("drop", { dataTransfer, clientX: quarterX, clientY: midY });
	await glyph.dispatchEvent("dragend", { dataTransfer });

	const groups = page.locator(".dv-groupview");
	await expect(groups).toHaveCount(2);
	const [leftBox, rightBox] = await Promise.all([groups.nth(0).boundingBox(), groups.nth(1).boundingBox()]);
	expect(leftBox!.x).toBeLessThan(rightBox!.x);
	// The chosen fraction actually sized the split -- not dockview's usual 50/50 default.
	expect(leftBox!.width).toBeGreaterThan(box.width * 0.15);
	expect(leftBox!.width).toBeLessThan(box.width * 0.35);
});

test("Dock Ruler: dragging past the midpoint docks to the right, sized from the guide's own fraction", async ({ page }) => {
	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();
	await expect(page.getByText("Workspace activity")).toBeVisible();

	const glyph = page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" });
	const content = page.locator(".dv-content-container");
	const box = (await content.boundingBox())!;
	const threeQuarterX = box.x + (box.width * 3) / 4;
	const midY = box.y + box.height / 2;

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await content.dispatchEvent("dragenter", { dataTransfer, clientX: threeQuarterX, clientY: midY });
	await content.dispatchEvent("dragover", { dataTransfer, clientX: threeQuarterX, clientY: midY });
	await expect(page.getByText("3/4").first()).toBeVisible();

	await content.dispatchEvent("drop", { dataTransfer, clientX: threeQuarterX, clientY: midY });
	await glyph.dispatchEvent("dragend", { dataTransfer });

	const groups = page.locator(".dv-groupview");
	await expect(groups).toHaveCount(2);
	const [leftBox, rightBox] = await Promise.all([groups.nth(0).boundingBox(), groups.nth(1).boundingBox()]);
	expect(leftBox!.x).toBeLessThan(rightBox!.x);
	// Docked right at 3/4 -> the new (right) group takes the remaining 1/4, not half.
	expect(rightBox!.width).toBeGreaterThan(box.width * 0.15);
	expect(rightBox!.width).toBeLessThan(box.width * 0.35);
});

test("a split's non-active pane dims (defocus); clicking the other pane flips which one is dimmed", async ({ page }) => {
	// Same split setup as the previous test -- two real, simultaneously-visible
	// panels, which is the only case dockview lets a defocus dim be visible at
	// all (an inactive *tab* in one group has its content removed from the DOM
	// entirely on switch, not merely hidden -- there's nothing there to dim).
	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();
	const glyph = page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" });
	const target = page.locator(".dv-dockview");
	const box = (await target.boundingBox())!;
	const edgeX = box.x + 5;
	const midY = box.y + box.height / 2;

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await target.dispatchEvent("dragenter", { dataTransfer, clientX: edgeX, clientY: midY });
	await target.dispatchEvent("dragover", { dataTransfer, clientX: edgeX, clientY: midY });
	await target.dispatchEvent("dragover", { dataTransfer, clientX: edgeX, clientY: midY });
	await target.dispatchEvent("drop", { dataTransfer, clientX: edgeX, clientY: midY });
	await glyph.dispatchEvent("dragend", { dataTransfer });

	const groups = page.locator(".dv-groupview");
	await expect(groups).toHaveCount(2);
	const leftPanel = groups.nth(0).locator(".animate-surface-spawn");
	const rightPanel = groups.nth(1).locator(".animate-surface-spawn");

	// Focus the left pane -- the freshly-created split's right pane is
	// whichever one dockview activated on drop, so assert relative to whichever
	// pane ends up dimmed, not a hardcoded left/right assumption.
	await groups.nth(0).click();
	await expect(leftPanel).toHaveClass(/opacity-100/);
	await expect(rightPanel).toHaveClass(/opacity-90/);

	await groups.nth(1).click();
	await expect(rightPanel).toHaveClass(/opacity-100/);
	await expect(leftPanel).toHaveClass(/opacity-90/);
});

test("the split/tab preview overlay is debounced: a fast pass over several positions shows nothing, and it appears once the pointer settles", async ({ page }) => {
	const glyph = page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" });
	const target = page.locator(".dv-dockview");
	const box = (await target.boundingBox())!;
	const overlay = page.locator(".dv-drop-target-edge, .dv-drop-target-selection, .dv-drop-target-dropzone");

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await glyph.dispatchEvent("dragstart", { dataTransfer });

	// A fast pass across several x positions with no real time between them --
	// each hop's implied velocity is far past DRAG_HINT_IDLE_VELOCITY_PX_PER_MS,
	// so every one of these frames must suppress its own overlay.
	for (const dx of [50, 400, 100, 600, 200, 700]) {
		await target.dispatchEvent("dragover", { dataTransfer, clientX: box.x + dx, clientY: box.y + box.height / 2 });
	}
	await expect(overlay).toHaveCount(0);

	// Once the pointer is idle (a real pause, then a dragover at the same
	// position -- zero implied velocity), the preview is allowed to show.
	await page.waitForTimeout(200);
	await target.dispatchEvent("dragover", { dataTransfer, clientX: box.x + 700, clientY: box.y + box.height / 2 });
	await expect(overlay.first()).toBeVisible();

	await glyph.dispatchEvent("dragend", { dataTransfer });
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

	await page.keyboard.press("Control+b");
	await expect(page.getByRole("navigation", { name: "Workspace selection" })).toBeVisible();
});

test("keyboard-only flow reaches selection, canvas, Chat, theme, palette, and shortcut help", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("alignment.theme", "light"));
	await page.reload();

	await page.keyboard.press("Control+1");
	await expect(page.getByRole("navigation", { name: "Workspace selection" })).toContainText("Bug");
	await expect(page.getByRole("button", { name: "Bug" })).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(page.getByRole("button", { name: "Metrics" })).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(page.getByRole("button", { name: "Bug" })).toBeFocused();

	await page.keyboard.press("Control+2");
	await expect(page.getByRole("region", { name: "Window view" })).toBeFocused();

	await revealChat(page);
	await page.getByRole("textbox", { name: "Message Alef" }).fill("Run the first slice");
	await page.keyboard.press("Control+Enter");
	await expect(page.getByText("Run the first slice")).toBeVisible(); // now the peek's own last-reply preview
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
	await expect(page.getByRole("button", { name: "Command palette" })).toHaveAttribute("aria-keyshortcuts", "Control+P");
	await page.keyboard.press("Control+P");
	await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

test("printable global shortcuts do not steal text input", async ({ page }) => {
	await revealChat(page);
	const composer = page.getByRole("textbox", { name: "Message Alef" });
	await composer.fill("b k / [ ]");
	await page.keyboard.type(" ordinary typing");
	await expect(composer).toHaveValue("b k / [ ] ordinary typing");
});

test("the first slice has no serious or critical automated accessibility violations", async ({ page }) => {
	await revealChat(page);
	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();
	const results = await new AxeBuilder({ page }).analyze();
	const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
	expect(blocking).toEqual([]);
});

test("the shell remains usable at a narrow viewport after keyboard-collapsing selection", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.keyboard.press("Control+b");
	await expect(page.getByRole("navigation", { name: "Workspace selection" })).toBeHidden();
	await expect(page.getByRole("navigation", { name: "Workspace quick selection" })).toBeVisible();
	const canvas = await page.getByRole("region", { name: "Window view" }).boundingBox();
	expect(canvas?.width).toBeGreaterThan(200);
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
