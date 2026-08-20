import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ZODIACD_PORT } from "../playwright.config.js";

const ZODIACD_BASE_URL = `http://127.0.0.1:${ZODIACD_PORT}`;

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Zodiac", exact: true })).toBeVisible();
	// Reload switches the active Chat conversation from the live "start" exchange just sent
	// to the fixture-backed historical one (session-sample.jsonl) these tests read against --
	// unrelated to Chat's own visibility, which no longer has a hidden state to reload past.
	await page.getByRole("textbox", { name: "Message Pi" }).fill("start");
	await page.getByRole("button", { name: "Send message" }).click();
	await expect(page.getByRole("navigation", { name: "Window Carousel" })).toBeVisible();
	await page.reload();
	await expect(page.getByRole("navigation", { name: "Window Carousel" })).toBeVisible();
});

/** Mock Workspaces start pre-seeded with several demo Windows (workspace-catalog.ts's createDemoWorkspace) -- tests read the real starting count/active index off the DOM rather than assuming "one Window at index 0". */
function windowButtons(carousel: Locator): Locator {
	return carousel.getByRole("button", { name: /^\d+$/ });
}

/** Excludes Chat's own group -- every Window always has one now, so a split test's own two panes are never the only two `.dv-groupview` elements. */
function nonChatGroups(page: Page): Locator {
	return page.locator(".dv-groupview").filter({ hasNotText: "Aware of:" });
}

async function activeWindowIndex(carousel: Locator): Promise<number> {
	const label = await carousel.locator('[aria-current="true"]').innerText();
	return Number(label);
}

/** The active glyph breathes continuously (opacity 0.85-1, animate-wisp-breathe) -- never reliably exactly "1". */
async function readOpacity(locator: Locator): Promise<number> {
	return Number(await locator.evaluate((element) => getComputedStyle(element).opacity));
}

function expectBreathingOpacity(value: number): void {
	expect(value).toBeGreaterThanOrEqual(0.85);
	expect(value).toBeLessThanOrEqual(1);
}

test("Chat is always docked as its own real split with a gutter -- never a pop-up, never toggled", async ({ page }) => {
	const chat = page.getByRole("region", { name: "Chat" });
	await expect(chat).toBeVisible();
	// The full transcript, immediately -- no peek/collapsed state exists once Chat is a real split.
	await expect(page.getByRole("log", { name: "AI conversation" })).toContainText("Please read the readme");
	await expect(page.getByRole("log", { name: "AI conversation" })).toContainText("You're welcome!");

	// Nothing hides it, regardless of pointer position -- there's no hidden state to reveal.
	await page.mouse.move(400, 200);
	await expect(chat).toBeVisible();

	// A real dockview split, alongside the canvas anchor reserving the rest of the space.
	await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible();
	await expect(page.getByText("Pull a Surface Template from the right pillar to dock it here.")).toBeVisible();
});

test("docking a Surface Template takes over the canvas anchor's spot, and Chat becomes aware of it", async ({ page }) => {
	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();

	await expect(page.getByText("Workspace activity")).toBeVisible();
	await expect(page.getByRole("region", { name: "Canvas" })).toHaveCount(0); // the anchor stepped aside
	await expect(page.getByText("Aware of: Activity")).toBeVisible();
	await expect(page.getByRole("region", { name: "Chat" })).toBeVisible(); // Chat keeps its own reserved split
});

test("closing the only real docked Surface brings the canvas anchor back, still reserving Chat's split", async ({ page }) => {
	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();
	await expect(page.getByText("Workspace activity")).toBeVisible();

	await page.locator(".dv-tab", { hasText: "Activity" }).locator(".dv-default-tab-action").click();

	await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible();
	await expect(page.getByText("Pull a Surface Template from the right pillar to dock it here.")).toBeVisible();
	await expect(page.getByText("Aware of: nothing else docked here")).toBeVisible();
});

test("Chat placement in Settings live-repositions an already-open Window's Chat, switching its orientation too", async ({ page }) => {
	const chat = page.getByRole("region", { name: "Chat" });
	const canvas = page.getByRole("region", { name: "Canvas" });

	await page.getByRole("button", { name: "Settings" }).click();
	await page.getByRole("button", { name: "Dock Chat to the Bottom" }).click();
	await page.getByRole("button", { name: "Close Settings" }).click();

	const chatBoxBottom = await chat.boundingBox();
	const canvasBoxBottom = await canvas.boundingBox();
	expect(chatBoxBottom!.y).toBeGreaterThan(canvasBoxBottom!.y); // below the canvas now
	// bottom placement is horizontal: the log sits beside the composer, not stacked above it.
	const logBoxBottom = (await page.getByRole("log", { name: "AI conversation" }).boundingBox())!;
	const composerBoxBottom = (await page.getByRole("textbox", { name: "Message Pi" }).boundingBox())!;
	expect(Math.abs(logBoxBottom.y - composerBoxBottom.y)).toBeLessThan(30);

	await page.getByRole("button", { name: "Settings" }).click();
	await page.getByRole("button", { name: "Dock Chat to the Left" }).click();
	await page.getByRole("button", { name: "Close Settings" }).click();

	const chatBoxLeft = await chat.boundingBox();
	const canvasBoxLeft = await canvas.boundingBox();
	expect(chatBoxLeft!.x).toBeLessThan(canvasBoxLeft!.x); // left of the canvas now
	// left placement is vertical: the log sits above the composer.
	const logBoxLeft = (await page.getByRole("log", { name: "AI conversation" }).boundingBox())!;
	const composerBoxLeft = (await page.getByRole("textbox", { name: "Message Pi" }).boundingBox())!;
	expect(composerBoxLeft.y).toBeGreaterThan(logBoxLeft.y + logBoxLeft.height - 20);
});

/** Zodiac starts with one Window -- add more via the "+" control for tests needing several. */
async function addWindows(page: Page, count: number): Promise<void> {
	for (let i = 0; i < count; i++) await page.getByRole("button", { name: "New Window" }).click();
}

test("several Windows in the Carousel center the active one and fade by distance, with an empty docking watermark", async ({ page }) => {
	const carousel = page.getByRole("navigation", { name: "Window Carousel" });
	const buttons = windowButtons(carousel);
	await addWindows(page, 6); // 7 total -- enough either side of center to see the fade falloff clamp
	const count = await buttons.count();
	expect(count).toBe(7);

	// "New Window" activates the newest one; select the middle index instead.
	const middleIndex = Math.floor(count / 2);
	await carousel.getByRole("button", { name: String(middleIndex) }).click();
	await expect(carousel.getByRole("button", { name: String(middleIndex) })).toHaveAttribute("aria-current", "true");
	// The click reflowed every button's position; the cursor may now coincidentally hover a different (faded) button.
	await page.mouse.move(0, 0);
	expectBreathingOpacity(await readOpacity(buttons.nth(middleIndex)));
	// Far enough from center that window-carousel-fade.ts's falloff clamps to fully invisible.
	await expect(buttons.first()).toHaveCSS("opacity", "0");
	await expect(buttons.last()).toHaveCSS("opacity", "0");

	await expect(page.getByText("Pull a Surface Template from the right pillar to dock it here.")).toBeVisible();
});

test("the Window Carousel is an infinite loop: the Window right before the first is the last one, not maximally far away", async ({ page }) => {
	const carousel = page.getByRole("navigation", { name: "Window Carousel" });
	const buttons = windowButtons(carousel);
	await addWindows(page, 4); // 5 total
	const count = await buttons.count();
	const lastIndex = count - 1;

	await buttons.nth(0).click();
	await expect(carousel.getByRole("button", { name: "0" })).toHaveAttribute("aria-current", "true");
	await page.mouse.move(0, 0); // avoid a coincidental hover on a reflowed button

	expectBreathingOpacity(await readOpacity(buttons.nth(0)));
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
	await addWindows(page, 3); // 4 total
	await carousel.getByRole("button", { name: "1" }).click(); // a real "next", not the wrap-around edge case
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

// Wheel-scrolling is its own policy (see WindowCarousel.tsx), not the same
// wrapping ring nextWindow/previousWindow use: past the last Window it
// creates a fresh ephemeral one instead of wrapping.
test("wheel-scrolling forward past the last real Window creates a fresh ephemeral one; scrolling back away from it (still undocked) prunes it", async ({ page }) => {
	const carousel = page.getByRole("navigation", { name: "Window Carousel" });
	const originalCount = await windowButtons(carousel).count();
	await page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" }).click();
	await expect(page.getByText("Workspace activity")).toBeVisible();

	await carousel.hover();
	await page.mouse.wheel(0, 100); // forward, past the last real Window -- creates a fresh ephemeral one, doesn't wrap
	await expect(windowButtons(carousel)).toHaveCount(originalCount + 1);
	await expect(carousel.getByRole("button", { name: String(originalCount) })).toHaveAttribute("aria-current", "true");
	await expect(page.getByText("Pull a Surface Template from the right pillar to dock it here.")).toBeVisible();

	await page.mouse.wheel(0, -100); // backward, away from the still-empty ephemeral Window -- pruned, not kept
	await expect(windowButtons(carousel)).toHaveCount(originalCount);
	await expect(carousel.getByRole("button", { name: "0" })).toHaveAttribute("aria-current", "true");
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

	// Reached via the tab's own context menu now, not a toolbar button.
	await page.locator(".dv-default-tab").filter({ hasText: "Activity" }).click({ button: "right" });
	await page.getByRole("menuitem", { name: "Save as template…" }).click();
	await page.getByLabel("Template title").fill("My Activity View");
	await page.getByRole("button", { name: "Save" }).click();

	await expect(page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock My Activity View" })).toBeVisible();

	await page.reload();
	await expect(page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock My Activity View" })).toBeVisible();
});

test("the gear icon opens Settings: moving a slider re-styles the shell live and survives reload", async ({ page }) => {
	// A plain CSS locator, not getByRole: Radix's Dialog marks background
	// content aria-hidden while open, which would make an ARIA-role query for
	// the Carousel time out even though it's still rendered and stylable.
	const carousel = page.locator('[aria-label="Window Carousel"]');
	const cornerRadiusBefore = await carousel.evaluate((element) => getComputedStyle(element).borderRadius);

	await page.getByRole("button", { name: "Settings" }).click();
	const dialog = page.getByRole("dialog", { name: "Settings" });
	await expect(dialog).toBeVisible();

	// Square end of the slider: the Window Carousel (part of the same shared
	// rounded-corner language as docked Surfaces and both pillars) goes flush.
	await dialog.getByLabel("Corner Radius").fill("0");
	await expect(carousel).toHaveCSS("border-radius", "0px");

	await page.getByRole("button", { name: "Close Settings" }).click();
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
	await expect(page.locator(".dv-groupview")).toHaveCount(2); // Chat's own reserved split + Activity, which replaced the canvas anchor

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
	await expect(groups).toHaveCount(3); // the new split, Activity's own, and Chat's own
	const boxes = await Promise.all((await groups.all()).map((group) => group.boundingBox()));
	const xs = boxes.map((box) => box!.x).sort((a, b) => a - b);
	expect(xs[0]).toBeLessThan(xs[1]!); // a genuine new leftmost group exists, not two stacked or tabbed panels
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
	const content = page.getByRole("tabpanel", { name: "Activity" });
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
	// Two samples at the same position: the Ruler is idle-velocity-gated too
	// (same policy as the root-edge case below it), so a single dragover
	// reads as an unconfirmed first sample, not a settled one.
	await content.dispatchEvent("dragover", { dataTransfer, clientX: quarterX, clientY: midY });
	await content.dispatchEvent("dragover", { dataTransfer, clientX: quarterX, clientY: midY });

	// The frame wraps the dock area with two bars per axis (above/below the
	// canvas) -- both show the same live label, not drawn over the content itself.
	await expect(page.getByTestId("dock-ruler")).toBeVisible();
	await expect(page.getByText("1/4").first()).toBeVisible();
	expect(await page.getByText("1/4").count()).toBe(2);
	// Dockview's own coarse overlay is superseded, not just visually covered.
	await expect(page.locator(".dv-drop-target-dropzone")).toBeHidden();

	await content.dispatchEvent("drop", { dataTransfer, clientX: quarterX, clientY: midY });
	await glyph.dispatchEvent("dragend", { dataTransfer });

	await expect(page.locator(".dv-groupview")).toHaveCount(3); // the new split, Activity's own, and Chat's own
	const groups = nonChatGroups(page);
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
	const content = page.getByRole("tabpanel", { name: "Activity" });
	const box = (await content.boundingBox())!;
	const threeQuarterX = box.x + (box.width * 3) / 4;
	const midY = box.y + box.height / 2;

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await content.dispatchEvent("dragenter", { dataTransfer, clientX: threeQuarterX, clientY: midY });
	// Two samples at the same position -- see the idle-velocity-gate comment above.
	await content.dispatchEvent("dragover", { dataTransfer, clientX: threeQuarterX, clientY: midY });
	await content.dispatchEvent("dragover", { dataTransfer, clientX: threeQuarterX, clientY: midY });
	await expect(page.getByText("3/4").first()).toBeVisible();

	await content.dispatchEvent("drop", { dataTransfer, clientX: threeQuarterX, clientY: midY });
	await glyph.dispatchEvent("dragend", { dataTransfer });

	await expect(page.locator(".dv-groupview")).toHaveCount(3); // the new split, Activity's own, and Chat's own
	const groups = nonChatGroups(page);
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

	await expect(page.locator(".dv-groupview")).toHaveCount(3); // the new split, Activity's own, and Chat's own
	const groups = nonChatGroups(page);
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
	// so every one of these frames must suppress its own overlay. Deep into the
	// canvas, most of these now land inside the anchor's own content (a real
	// panel, not a watermark) -- content-kind hovers get a different class
	// (dv-drop-target-content), which this selector doesn't match anyway.
	for (const dx of [50, 400, 100, 600, 200, 700]) {
		await target.dispatchEvent("dragover", { dataTransfer, clientX: box.x + dx, clientY: box.y + box.height / 2 });
	}
	await expect(overlay).toHaveCount(0);

	// Settling at the root edge specifically (not deep content, now covered by
	// the Dock Ruler instead -- see its own tests). Two samples at the same
	// position, same as above: the first is still a jump from the fast pass's
	// last position, only the second reads as genuinely idle.
	await page.waitForTimeout(200);
	await target.dispatchEvent("dragover", { dataTransfer, clientX: box.x + 5, clientY: box.y + box.height / 2 });
	await target.dispatchEvent("dragover", { dataTransfer, clientX: box.x + 5, clientY: box.y + box.height / 2 });
	await expect(overlay.first()).toBeVisible();

	await glyph.dispatchEvent("dragend", { dataTransfer });
});

test("collapsing/expanding Workspace selection only changes its width -- the first Workspace's own vertical position never shifts as a side effect", async ({ page }) => {
	const expandedFirstRow = page.getByRole("navigation", { name: "Workspace selection" }).locator("li").first();
	const expandedBox = (await expandedFirstRow.boundingBox())!;

	await page.keyboard.press("Control+b");
	const collapsedFirstGlyph = page.getByRole("navigation", { name: "Workspace quick selection" }).getByRole("button").nth(1); // after CollapsedToggle
	const collapsedBox = (await collapsedFirstGlyph.boundingBox())!;

	// Width is the axis this toggle is actually about -- free to differ.
	expect(collapsedBox.width).not.toBeCloseTo(expandedBox.width, 0);
	// Vertical position is not: both states' own header precedes the first
	// Workspace by the same total height, so it lands at the same y either way.
	expect(Math.abs(collapsedBox.y - expandedBox.y)).toBeLessThan(2);

	await page.keyboard.press("Control+b");
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
	await page.evaluate(() => localStorage.setItem("zodiac.theme", "light"));
	await page.reload();

	// Zodiac starts with zero Workspaces and no fixed demo catalog -- create two real ones.
	await page.getByRole("button", { name: "Create a new Workspace" }).click();
	await page.getByLabel("Workspace title").fill("Second Workspace");
	await page.getByRole("button", { name: "Create" }).click();

	const selection = page.getByRole("navigation", { name: "Workspace selection" });
	// [data-workspace-catalog-id]: excludes each row's own "Close" button sibling.
	const catalogButtons = selection.getByRole("list", { name: "Workspaces" }).locator("[data-workspace-catalog-id]");
	const firstTitle = (await catalogButtons.first().textContent())!.trim();
	const secondTitle = (await catalogButtons.nth(1).textContent())!.trim();

	// Control+1 focuses the currently-active entry, not index 0 -- creating
	// "Second Workspace" selected it, so re-select the first one first.
	await catalogButtons.first().click();
	await page.keyboard.press("Control+1");
	await expect(selection).toContainText(firstTitle);
	await expect(catalogButtons.filter({ hasText: firstTitle })).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(catalogButtons.filter({ hasText: secondTitle })).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(catalogButtons.filter({ hasText: firstTitle })).toBeFocused();

	await page.keyboard.press("Control+2");
	await expect(page.getByRole("region", { name: "Window view" })).toBeFocused();

	await page.getByRole("textbox", { name: "Message Pi" }).fill("Run the first slice");
	await page.keyboard.press("Control+Enter");
	await expect(page.getByText("Run the first slice")).toBeVisible(); // now the peek's own last-reply preview
	await expect(page.getByRole("textbox", { name: "Message Pi" })).toHaveValue("");

	await expect(page.getByRole("button", { name: "Cycle color theme" })).toHaveAttribute("aria-keyshortcuts", "Control+Alt+L");
	await page.keyboard.press("Control+Alt+L");
	expect(await page.evaluate(() => localStorage.getItem("zodiac.theme"))).toBe("dark");
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
	// A Picker row (packages/ui/src/Picker.tsx), built on cmdk's Command.Item -- a real
	// role="option" inside role="listbox", not a plain button, even though it's mouse-clickable.
	await page.getByRole("option", { name: "Change shortcut for Open command palette" }).click();
	await page.keyboard.press("Control+P");
	await expect(page.getByRole("option", { name: "Change shortcut for Open command palette" })).toContainText("Ctrl+P");
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
	const composer = page.getByRole("textbox", { name: "Message Pi" });
	await composer.fill("b k / [ ]");
	// Chat's composer is a real docked panel now, re-rendering via
	// updateParameters on every keystroke -- zero-delay type() outruns that
	// and drops characters. 30ms is still far faster than real typing, and
	// unrelated to what this test actually checks (keybindings don't steal focus).
	await page.keyboard.type(" ordinary typing", { delay: 30 });
	await expect(composer).toHaveValue("b k / [ ] ordinary typing");
});

test("the first slice has no serious or critical automated accessibility violations", async ({ page }) => {
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
	// zodiacd stage 4: these routes live on the daemon's own origin now, not
	// the web app's -- see the "zodiacd API surface" Papyrus Doc.
	const conversationsResponse = await request.get(`${ZODIACD_BASE_URL}/api/conversations`);
	expect(conversationsResponse.ok()).toBe(true);
	const conversationsBody = await conversationsResponse.text();
	expect(conversationsBody).not.toContain("filePath");
	expect(conversationsBody).not.toContain("session-sample.jsonl");

	const missingIdResponse = await request.get(`${ZODIACD_BASE_URL}/api/conversations/events`);
	expect(missingIdResponse.status()).toBe(400);
	expect(await missingIdResponse.json()).toMatchObject({ code: "conversation-id-required" });

	// conversationId is looked up in a pre-built map, never joined onto a
	// filesystem path -- a traversal-shaped id must resolve like any other
	// unknown id (404), not read an arbitrary file.
	for (const traversalId of ["../../../../etc/passwd", "/etc/passwd", "..%2f..%2fetc%2fpasswd"]) {
		const traversalResponse = await request.get(`${ZODIACD_BASE_URL}/api/conversations/events?conversationId=${encodeURIComponent(traversalId)}`);
		expect(traversalResponse.status()).toBe(404);
		expect(await traversalResponse.json()).toMatchObject({ code: "conversation-not-found" });
	}
});

test("legacy product storage (agent-deck era) migrates all the way to today's namespace without losing preferences", async ({ page }) => {
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
		theme: localStorage.getItem("zodiac.theme"),
		selection: localStorage.getItem("zodiac.workspace-selection-collapsed"),
		legacyLayout: localStorage.getItem("zodiac.workspace-layout.legacy-v1"),
	}));
	expect(migrated).toEqual({ theme: "dark", selection: "true", legacyLayout: '{"schemaVersion":1,"panels":[]}' });
});

