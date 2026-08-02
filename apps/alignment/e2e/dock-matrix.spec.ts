import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * A systematic matrix of multi-Surface docking combinations -- Empty -> One,
 * One -> Two (every edge + tab-insert, both drag and click), Two -> Three
 * (nested splits, tab-insert into an existing pane), closing a pane out of a
 * split, and Dock Ruler-sized splits. Each scenario asserts real DOM
 * structure (group/tab counts, relative geometry) rather than trusting a
 * screenshot -- this file exists because a real, reported docking
 * degradation wasn't caught by the narrower single-scenario tests elsewhere
 * in this suite.
 */

// dockview's "Spaced" theme (themeLightSpaced/themeAbyssSpaced -- see
// WindowDockview.tsx's own comment on why) deliberately adds a margin
// around the whole grid and a gutter between sibling panes -- confirmed by
// directly measuring both (a lone pane's own width is ~20px less than the
// canvas's, i.e. ~10px on each side; two adjacent panes sit ~10px apart),
// not a bug to design tests around as if panes were edge-to-edge.
const SPACED_THEME_GUTTER_PX = 10;

test.beforeEach(async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Alignment", exact: true })).toBeVisible();
	await expect(page.getByRole("navigation", { name: "Window Carousel" })).toBeVisible();
});

function activityGlyph(page: Page): Locator {
	return page.getByRole("navigation", { name: "Surface Templates" }).getByRole("button", { name: "Dock Activity" });
}

/** dockview's own default placement when no drag geometry exists: a tab inserted into the currently active group (or the Window's very first group, if empty). */
async function dockViaClick(page: Page): Promise<void> {
	await activityGlyph(page).click();
	await expect(page.getByText("Workspace activity").first()).toBeVisible();
}

/**
 * Drag-to-dock onto `target`, at a fractional offset within its own box (0/0
 * is its top-left corner, 1/1 its bottom-right). Every drag test in this
 * suite dispatches events directly rather than driving real mouse movement --
 * Chromium's automation layer doesn't reliably synthesize a genuine native
 * HTML5 dragstart from raw mouse events (confirmed directly, not assumed --
 * see the Dock Ruler frame's own regression test/doc), so dispatchEvent is
 * the only reliable way to exercise this in Playwright. dispatchEvent skips
 * real hit-testing by design (it targets the named element directly,
 * regardless of what visually sits on top of it), so a scenario claiming to
 * catch a hit-testing bug still needs its own document.elementFromPoint
 * assertion, not just a dispatched-event outcome -- see the Dock Ruler
 * frame's own hit-testing regression test elsewhere in this suite for that
 * distinct check.
 */
async function dockViaDrag(page: Page, target: Locator, offsetXRatio: number, offsetYRatio: number): Promise<void> {
	const box = (await target.boundingBox())!;
	const x = box.x + box.width * offsetXRatio;
	const y = box.y + box.height * offsetYRatio;
	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	const glyph = activityGlyph(page);
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await target.dispatchEvent("dragenter", { dataTransfer, clientX: x, clientY: y });
	// Two samples at the same position: the empty-Window watermark's own
	// debounce/idle-velocity policy (a separate mechanism from the Dock
	// Ruler's own live per-group tracking -- see WindowDockview.tsx) needs a
	// confirmed low-velocity comparison before accepting a drop target at
	// all, which any real drag satisfies but a single synthetic dragover does
	// not.
	await target.dispatchEvent("dragover", { dataTransfer, clientX: x, clientY: y });
	await target.dispatchEvent("dragover", { dataTransfer, clientX: x, clientY: y });
	await target.dispatchEvent("drop", { dataTransfer, clientX: x, clientY: y });
	await glyph.dispatchEvent("dragend", { dataTransfer });
}

function groups(page: Page): Locator {
	return page.locator(".dv-groupview");
}

function tabs(page: Page): Locator {
	return page.locator(".dv-tab");
}

function dockCanvas(page: Page): Locator {
	return page.getByRole("region", { name: "Window view" });
}

interface Box {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

async function groupBoxes(page: Page): Promise<Box[]> {
	return groups(page).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
}

/** The Nth group's own content container -- the correct drag target for a further split (see dockViaDrag's own doc comment on why dispatchEvent needs the real per-group element, not the outer canvas). */
function groupContent(page: Page, index: number): Locator {
	return groups(page).nth(index).locator(".dv-content-container");
}

async function indexOfExtreme(page: Page, pick: (a: Box, b: Box) => Box): Promise<number> {
	const boxes = await groupBoxes(page);
	const extreme = boxes.reduce(pick);
	return boxes.indexOf(extreme);
}

async function leftmostGroupContent(page: Page): Promise<Locator> {
	return groupContent(page, await indexOfExtreme(page, (a, b) => (a.x <= b.x ? a : b)));
}

async function rightmostGroupContent(page: Page): Promise<Locator> {
	return groupContent(page, await indexOfExtreme(page, (a, b) => (a.x >= b.x ? a : b)));
}

async function topmostGroupContent(page: Page): Promise<Locator> {
	return groupContent(page, await indexOfExtreme(page, (a, b) => (a.y <= b.y ? a : b)));
}

async function bottommostGroupContent(page: Page): Promise<Locator> {
	return groupContent(page, await indexOfExtreme(page, (a, b) => (a.y >= b.y ? a : b)));
}

/**
 * The group-level (`.dv-groupview`, including its own tab strip) box for
 * whichever group is currently the extreme match -- distinct from
 * `leftmostGroupContent` etc., which resolve to the group's own
 * `.dv-content-container` (content only, excluding the tab strip) since
 * that's the correct *drag target*. A "before" snapshot meant to be compared
 * against a later `groupBoxes()` read (group-level) must use this instead,
 * or the tab strip's own height/offset shows up as a false geometry change.
 */
async function leftmostGroupBox(page: Page): Promise<Box> {
	const boxes = await groupBoxes(page);
	return boxes.reduce((a, b) => (a.x <= b.x ? a : b));
}

async function rightmostGroupBox(page: Page): Promise<Box> {
	const boxes = await groupBoxes(page);
	return boxes.reduce((a, b) => (a.x >= b.x ? a : b));
}

async function topmostGroupBox(page: Page): Promise<Box> {
	const boxes = await groupBoxes(page);
	return boxes.reduce((a, b) => (a.y <= b.y ? a : b));
}

async function bottommostGroupBox(page: Page): Promise<Box> {
	const boxes = await groupBoxes(page);
	return boxes.reduce((a, b) => (a.y >= b.y ? a : b));
}

/**
 * Every Dock Ruler artifact -- the outer frame, its bars/marks, and the
 * in-content shade -- must be fully gone once a drag concludes. A leftover
 * one is a real, user-visible bug (a persistent accent-colored overlay is
 * exactly the kind of thing a screenshot-driven report surfaces and a
 * narrower single-scenario test can miss).
 */
async function expectNoStrayRulerArtifacts(page: Page): Promise<void> {
	await expect(page.getByTestId("dock-ruler")).toHaveCount(0);
	await expect(page.getByTestId("dock-ruler-bar")).toHaveCount(0);
	await expect(page.getByTestId("dock-ruler-mark")).toHaveCount(0);
	await expect(page.getByTestId("dock-ruler-shade")).toHaveCount(0);
}

test("1. Empty -> Dock One, via click", async ({ page }) => {
	await expect(groups(page)).toHaveCount(0);
	await dockViaClick(page);
	await expect(groups(page)).toHaveCount(1);
	await expect(tabs(page)).toHaveCount(1);
	await expectNoStrayRulerArtifacts(page);
});

test("2. Empty -> Dock One, via drag onto the empty watermark", async ({ page }) => {
	await expect(groups(page)).toHaveCount(0);
	await dockViaDrag(page, page.locator(".dv-dockview"), 0.5, 0.5);
	await expect(groups(page)).toHaveCount(1);
	await expect(tabs(page)).toHaveCount(1);
	await expectNoStrayRulerArtifacts(page);
});

test("3. One (full) -> Two, drag onto the LEFT edge -> horizontal split, new pane left of the original", async ({ page }) => {
	await dockViaClick(page);
	const original = groupContent(page, 0);
	await dockViaDrag(page, original, 0.1, 0.5);

	await expect(groups(page)).toHaveCount(2);
	await expect(tabs(page)).toHaveCount(2);
	const [a, b] = await groupBoxes(page);
	expect(Math.min(a!.x, b!.x)).toBeLessThan(Math.max(a!.x, b!.x)); // genuinely side by side
	expect(Math.abs(a!.y - b!.y)).toBeLessThan(2); // same row -- a horizontal split, not vertical
	await expectNoStrayRulerArtifacts(page);
});

test("4. One (full) -> Two, drag onto the RIGHT edge -> horizontal split, new pane right of the original", async ({ page }) => {
	await dockViaClick(page);
	const original = groupContent(page, 0);
	const originalBox = (await original.boundingBox())!;
	await dockViaDrag(page, original, 0.9, 0.5);

	await expect(groups(page)).toHaveCount(2);
	const boxes = await groupBoxes(page);
	const originalStillPresent = boxes.some((box) => Math.abs(box.x - originalBox.x) < 2);
	expect(originalStillPresent).toBe(true); // the original pane stayed on the left, unmoved
	const rightBox = (await (await rightmostGroupContent(page)).boundingBox())!;
	expect(rightBox.x).toBeGreaterThan(originalBox.x);
	await expectNoStrayRulerArtifacts(page);
});

test("5. One (full) -> Two, drag onto the TOP edge -> vertical split, new pane above the original", async ({ page }) => {
	await dockViaClick(page);
	const original = groupContent(page, 0);
	await dockViaDrag(page, original, 0.5, 0.1);

	await expect(groups(page)).toHaveCount(2);
	const [a, b] = await groupBoxes(page);
	expect(Math.abs(a!.x - b!.x)).toBeLessThan(2); // same column -- a vertical split, not horizontal
	expect(Math.min(a!.y, b!.y)).toBeLessThan(Math.max(a!.y, b!.y));
	await expectNoStrayRulerArtifacts(page);
});

test("6. One (full) -> Two, drag onto the BOTTOM edge -> vertical split, new pane below the original", async ({ page }) => {
	await dockViaClick(page);
	const original = groupContent(page, 0);
	const originalBox = (await original.boundingBox())!;
	await dockViaDrag(page, original, 0.5, 0.9);

	await expect(groups(page)).toHaveCount(2);
	const bottomBox = (await (await bottommostGroupContent(page)).boundingBox())!;
	expect(bottomBox.y).toBeGreaterThan(originalBox.y);
	await expectNoStrayRulerArtifacts(page);
});

test("7. One (full) -> Two, drag onto dead center -> tab-inserted into the SAME group, not a split", async ({ page }) => {
	await dockViaClick(page);
	const original = groupContent(page, 0);
	await dockViaDrag(page, original, 0.5, 0.5);

	await expect(groups(page)).toHaveCount(1); // still one pane...
	await expect(tabs(page)).toHaveCount(2); // ...now with two tabs
	await expectNoStrayRulerArtifacts(page);
});

test("8. One (full) -> Two, via a second click -> tab-inserted into the active group, same outcome as a center drag", async ({ page }) => {
	await dockViaClick(page);
	await dockViaClick(page);

	await expect(groups(page)).toHaveCount(1);
	await expect(tabs(page)).toHaveCount(2);
	await expectNoStrayRulerArtifacts(page);
});

test("9. Two (left|right split) -> Three, drag onto the LEFT pane's own LEFT edge -> a three-column row", async ({ page }) => {
	await dockViaClick(page);
	await dockViaDrag(page, groupContent(page, 0), 0.9, 0.5); // -> two side by side
	await expect(groups(page)).toHaveCount(2);

	const left = await leftmostGroupContent(page);
	await dockViaDrag(page, left, 0.1, 0.5);

	await expect(groups(page)).toHaveCount(3);
	await expect(tabs(page)).toHaveCount(3);
	const boxes = await groupBoxes(page);
	const sameRow = boxes.every((box) => Math.abs(box.y - boxes[0]!.y) < 2);
	expect(sameRow).toBe(true); // all three still in one row, not a mixed layout
	const xs = boxes.map((box) => box.x).sort((a, b) => a - b);
	expect(xs[0]).toBeLessThan(xs[1]!);
	expect(xs[1]).toBeLessThan(xs[2]!); // three genuinely distinct columns
	await expectNoStrayRulerArtifacts(page);
});

test("10. Two (left|right split) -> Three, drag onto the RIGHT pane's own BOTTOM edge -> a mixed layout (left column full-height, right column split top/bottom)", async ({ page }) => {
	await dockViaClick(page);
	await dockViaDrag(page, groupContent(page, 0), 0.9, 0.5); // -> two side by side
	await expect(groups(page)).toHaveCount(2);
	const leftBoxBefore = await leftmostGroupBox(page);

	const right = await rightmostGroupContent(page);
	const rightBoxBefore = (await right.boundingBox())!;
	await dockViaDrag(page, right, 0.5, 0.9);

	await expect(groups(page)).toHaveCount(3);
	const boxes = await groupBoxes(page);
	// The original left pane is untouched -- same box as before the third dock.
	const leftUntouched = boxes.some((box) => Math.abs(box.x - leftBoxBefore.x) < 2 && Math.abs(box.height - leftBoxBefore.height) < 2);
	expect(leftUntouched).toBe(true);
	// The right column split into two stacked panes, each roughly half the original right pane's own height.
	const rightColumn = boxes.filter((box) => Math.abs(box.x - rightBoxBefore.x) < 2 || box.x > leftBoxBefore.x + leftBoxBefore.width);
	expect(rightColumn.length).toBe(2);
	expect(Math.abs(rightColumn[0]!.x - rightColumn[1]!.x)).toBeLessThan(2); // same column
	expect(Math.abs(rightColumn[0]!.y - rightColumn[1]!.y)).toBeGreaterThan(10); // genuinely stacked, not overlapping
	await expectNoStrayRulerArtifacts(page);
});

test("11. Two (top/bottom split) -> Three, drag onto the BOTTOM pane's own RIGHT edge -> a mixed layout (top row full-width, bottom row split left/right)", async ({ page }) => {
	await dockViaClick(page);
	await dockViaDrag(page, groupContent(page, 0), 0.5, 0.9); // -> two stacked
	await expect(groups(page)).toHaveCount(2);
	const topBoxBefore = await topmostGroupBox(page);

	const bottom = await bottommostGroupContent(page);
	await dockViaDrag(page, bottom, 0.9, 0.5);

	await expect(groups(page)).toHaveCount(3);
	const boxes = await groupBoxes(page);
	const topUntouched = boxes.some((box) => Math.abs(box.y - topBoxBefore.y) < 2 && Math.abs(box.width - topBoxBefore.width) < 2);
	expect(topUntouched).toBe(true);
	const bottomRow = boxes.filter((box) => box.y > topBoxBefore.y + topBoxBefore.height - 2);
	expect(bottomRow.length).toBe(2);
	expect(Math.abs(bottomRow[0]!.y - bottomRow[1]!.y)).toBeLessThan(2); // same row
	expect(Math.abs(bottomRow[0]!.x - bottomRow[1]!.x)).toBeGreaterThan(10); // genuinely side by side
	await expectNoStrayRulerArtifacts(page);
});

test("12. Two (left|right split) -> Three docked Surfaces but still TWO panes, drag onto one pane's dead center -> tab-inserted there, the other pane untouched", async ({ page }) => {
	await dockViaClick(page);
	await dockViaDrag(page, groupContent(page, 0), 0.9, 0.5); // -> two side by side
	await expect(groups(page)).toHaveCount(2);

	const left = await leftmostGroupContent(page);
	await dockViaDrag(page, left, 0.5, 0.5);

	await expect(groups(page)).toHaveCount(2); // still two panes...
	await expect(tabs(page)).toHaveCount(3); // ...but three docked Surfaces total
	await expectNoStrayRulerArtifacts(page);
});

test("13. Two (side by side) -> close one -> the remaining pane alone fills the whole canvas", async ({ page }) => {
	await dockViaClick(page);
	await dockViaDrag(page, groupContent(page, 0), 0.9, 0.5); // -> two side by side
	await expect(groups(page)).toHaveCount(2);
	const canvasBox = (await dockCanvas(page).boundingBox())!;

	await page.locator(".dv-default-tab-action").first().click();

	await expect(groups(page)).toHaveCount(1);
	await expect(tabs(page)).toHaveCount(1);
	const remaining = (await groupBoxes(page))[0]!;
	expect(Math.abs(remaining.width - (canvasBox.width - 2 * SPACED_THEME_GUTTER_PX))).toBeLessThan(4); // fills the canvas (minus the Spaced theme's own outer margin), no stale leftover slice
	await expectNoStrayRulerArtifacts(page);
});

test("14. Three (nested three-column) -> close the MIDDLE pane -> the other two remain, correctly reflowed, no stale pane", async ({ page }) => {
	await dockViaClick(page);
	await dockViaDrag(page, groupContent(page, 0), 0.9, 0.5); // -> two side by side
	const left = await leftmostGroupContent(page);
	await dockViaDrag(page, left, 0.1, 0.5); // -> three columns
	await expect(groups(page)).toHaveCount(3);

	const boxesBefore = (await groupBoxes(page)).sort((a, b) => a.x - b.x);
	const middleX = boxesBefore[1]!.x + boxesBefore[1]!.width / 2;
	const middleY = boxesBefore[1]!.y + boxesBefore[1]!.height / 2;
	const middleTabCloseButton = await page.evaluateHandle(
		([x, y]) => document.elementFromPoint(x, y)?.closest(".dv-groupview")?.querySelector(".dv-default-tab-action"),
		[middleX, middleY] as const,
	);
	await (middleTabCloseButton.asElement() as import("@playwright/test").ElementHandle<Element>).click();

	await expect(groups(page)).toHaveCount(2);
	await expect(tabs(page)).toHaveCount(2);
	const boxesAfter = (await groupBoxes(page)).sort((a, b) => a.x - b.x);
	// The remaining two panes are genuinely adjacent (just the Spaced theme's
	// own standing gutter between them -- no leftover extra gap where the
	// closed middle pane, and its own two gutters, used to be).
	expect(Math.abs(boxesAfter[0]!.x + boxesAfter[0]!.width + SPACED_THEME_GUTTER_PX - boxesAfter[1]!.x)).toBeLessThan(4);
	await expectNoStrayRulerArtifacts(page);
});

test("15. One (full) -> Two via the Dock Ruler at 1/3 -> the new left pane is sized to that fraction, not a default 50/50", async ({ page }) => {
	await dockViaClick(page);
	const original = groupContent(page, 0);
	const canvasBox = (await original.boundingBox())!;
	await dockViaDrag(page, original, 1 / 3, 0.5);

	await expect(groups(page)).toHaveCount(2);
	const leftBox = (await (await leftmostGroupContent(page)).boundingBox())!;
	expect(leftBox.width).toBeGreaterThan(canvasBox.width * 0.2);
	expect(leftBox.width).toBeLessThan(canvasBox.width * 0.45); // meaningfully less than half
	await expectNoStrayRulerArtifacts(page);
});

test("16. One (full) -> Two via the Dock Ruler at 2/3 docking right -> the new right pane takes the remaining ~1/3", async ({ page }) => {
	await dockViaClick(page);
	const original = groupContent(page, 0);
	const canvasBox = (await original.boundingBox())!;
	await dockViaDrag(page, original, 2 / 3, 0.5);

	await expect(groups(page)).toHaveCount(2);
	const rightBox = (await (await rightmostGroupContent(page)).boundingBox())!;
	expect(rightBox.width).toBeGreaterThan(canvasBox.width * 0.2);
	expect(rightBox.width).toBeLessThan(canvasBox.width * 0.45);
	await expectNoStrayRulerArtifacts(page);
});

test("17. A cancelled drag (dragend with no drop) leaves the Window untouched and no stray Dock Ruler state behind", async ({ page }) => {
	await dockViaClick(page);
	await expect(groups(page)).toHaveCount(1);
	const boxBefore = (await groupBoxes(page))[0]!;

	const target = groupContent(page, 0);
	const box = (await target.boundingBox())!;
	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	const glyph = activityGlyph(page);
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await target.dispatchEvent("dragenter", { dataTransfer, clientX: box.x + box.width * 0.2, clientY: box.y + box.height / 2 });
	await target.dispatchEvent("dragover", { dataTransfer, clientX: box.x + box.width * 0.2, clientY: box.y + box.height / 2 });
	await expect(page.getByTestId("dock-ruler")).toBeVisible(); // the frame did show mid-drag...
	await glyph.dispatchEvent("dragend", { dataTransfer }); // ...cancelled, no drop

	await expect(groups(page)).toHaveCount(1); // unchanged -- no phantom second pane
	await expect(tabs(page)).toHaveCount(1);
	const boxAfter = (await groupBoxes(page))[0]!;
	expect(boxAfter.width).toBeCloseTo(boxBefore.width, 0);
	await expectNoStrayRulerArtifacts(page); // ...and gone now that the drag ended
});

test("18. Three (mixed L-shaped layout) has no duplicate DOM: exactly as many tabs, content containers, and watermarks as docked Surfaces, never more", async ({ page }) => {
	await dockViaClick(page);
	await dockViaDrag(page, groupContent(page, 0), 0.9, 0.5); // -> two side by side
	const right = await rightmostGroupContent(page);
	await dockViaDrag(page, right, 0.5, 0.9); // -> right column splits top/bottom

	await expect(groups(page)).toHaveCount(3);
	await expect(tabs(page)).toHaveCount(3);
	await expect(page.locator(".dv-content-container")).toHaveCount(3);
	await expect(page.getByText("Pull a Surface Template from the right pillar to dock it here.")).toHaveCount(0); // no leftover watermark once every pane is occupied
	await expectNoStrayRulerArtifacts(page);
});
