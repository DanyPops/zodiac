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
	await expect(page.getByRole("heading", { name: "Zodiac", exact: true })).toBeVisible();
	// Zodiac starts with zero Workspaces -- a Window Carousel only exists once
	// one is auto-created from a first sent message (see App.tsx's own
	// sendMessage). This spec is about docking within an existing Window, not
	// Workspace creation, so get one the same way a real user would.
	await page.getByRole("textbox", { name: "Message Pi" }).fill("start");
	await page.getByRole("button", { name: "Send message" }).click();
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
 * is its top-left corner, 1/1 its bottom-right). Most drag tests in this
 * suite dispatch events directly rather than driving real mouse movement --
 * fast, and deterministic regardless of what's visually stacked on top of
 * the target, which is exactly the point most of these scenarios care
 * about (split geometry, tab counts). But dispatchEvent skips real
 * hit-testing by design (targets the named element directly), so it
 * structurally cannot catch a bug where a real drop's own hit-test resolves
 * to the wrong element -- confirmed the hard way: a real, reported "docking
 * onto an existing pane silently does nothing" bug turned out to be exactly
 * that (the Dock Ruler's own overlay wrapper missing pointer-events-none,
 * swallowing the real native drop), invisible to every dispatchEvent-based
 * test in this file and only caught by a real page.mouse drag -- see "real
 * mouse drag" further down. Both techniques stay in this suite: dispatchEvent
 * for geometry/count assertions, real mouse drag wherever hit-testing itself
 * is what's being verified.
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

async function topmostGroupBox(page: Page): Promise<Box> {
	const boxes = await groupBoxes(page);
	return boxes.reduce((a, b) => (a.y <= b.y ? a : b));
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

test("19. A cancelled drag near the canvas's own outer edge (root-level, not a specific pane's content) leaves no stuck dockview overlay behind", async ({ page }) => {
	// Regression test for a real degradation reported live: dockview's own
	// root-level drop-target overlay (.dv-drop-target-anchor, owned by
	// rootDropTargetService -- a genuinely distinct mechanism from both the
	// Dock Ruler's own frame and its in-content shade) has no reliable
	// cleanup path for an externally-sourced drag. Its own dragend listener
	// is bound to .dv-dockview, which a native dragend fired on our Surface
	// Templates pillar (an unrelated sibling, not an ancestor) never reaches;
	// its own dragleave handling is a deliberate no-op whenever an override
	// target -- exactly this root-level case -- is active. Confirmed live via
	// a real browser (not just this dispatchEvent-driven test, since a
	// synthetic dragend has the same bubbling semantics as a genuine one
	// here) before fixing: dragging near the canvas's outer edge and
	// cancelling left a purple highlight box stuck in the DOM indefinitely.
	await dockViaClick(page);
	const dockview = page.locator(".dv-dockview");
	const box = (await dockview.boundingBox())!;
	// The root-level activation band is a fixed 10px from the true edge
	// (DEFAULT_ROOT_OVERLAY_MODEL.activationSize), not a percentage of the
	// canvas -- a ratio-based offset (as the Dock Ruler's own tests use for
	// its much wider ~whole-pane activation) can miss this much narrower
	// band entirely depending on viewport width.
	const nearEdgeX = box.x + box.width - 5;
	const midY = box.y + box.height / 2;

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	const glyph = activityGlyph(page);
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await dockview.dispatchEvent("dragenter", { dataTransfer, clientX: nearEdgeX, clientY: midY });
	await dockview.dispatchEvent("dragover", { dataTransfer, clientX: nearEdgeX, clientY: midY });
	await dockview.dispatchEvent("dragover", { dataTransfer, clientX: nearEdgeX, clientY: midY }); // second sample -- this root-level overlay has its own idle-velocity debounce, same as the empty-watermark case
	await glyph.dispatchEvent("dragend", { dataTransfer }); // cancelled, no drop

	// The DOM node itself still exists (dockview's own JS creates it
	// regardless of CSS) -- the fix hides it, it doesn't prevent creation.
	await expect(page.locator(".dv-drop-target-anchor")).toBeHidden();
	await expect(groups(page)).toHaveCount(1); // unchanged -- no phantom split
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

test("20. Docking into a second Window works the same as the first -- each Window mounts its own independent WindowDockview instance", async ({ page }) => {
	await dockViaClick(page); // Window 0 gets its first Surface
	await page.getByRole("button", { name: "New Window" }).click(); // Window 1, empty, now active

	await expect(groups(page)).toHaveCount(0); // Window 1's own canvas, not Window 0's leftover group
	await dockViaDrag(page, page.locator(".dv-dockview"), 0.5, 0.5);
	await expect(groups(page)).toHaveCount(1);
	await expect(tabs(page)).toHaveCount(1);

	await dockViaDrag(page, groupContent(page, 0), 0.9, 0.5); // a second dock, by drag, onto Window 1's own now-existing pane
	await expect(groups(page)).toHaveCount(2);
	await expect(tabs(page)).toHaveCount(2);
	await expectNoStrayRulerArtifacts(page);
});

/**
 * A real page.mouse drag: hover the source, press, move in several steps
 * (crossing the browser's own drag-initiation threshold, then two samples at
 * rest over the target -- Playwright's own dragover note, and our idle-
 * velocity gate, both need at least two), release. Unlike dockViaDrag, this
 * goes through real hit-testing at every step, the only way to catch a bug
 * where something else is actually sitting over the drop target.
 */
async function realMouseDrag(page: Page, source: Locator, target: Locator, targetRatio = { x: 0.5, y: 0.5 }): Promise<void> {
	const sourceBox = (await source.boundingBox())!;
	const targetBox = (await target.boundingBox())!;
	await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 10, sourceBox.y + sourceBox.height / 2 + 10, { steps: 5 });
	const tx = targetBox.x + targetBox.width * targetRatio.x;
	const ty = targetBox.y + targetBox.height * targetRatio.y;
	await page.mouse.move(tx, ty, { steps: 20 });
	await page.mouse.move(tx, ty);
	await page.mouse.up();
}

test("21. Real mouse drag (real hit-testing, not dispatchEvent) onto an existing pane's content actually docks -- regression for a real bug: the Dock Ruler's own overlay wrapper had no pointer-events-none, so a genuine drop's hit-test resolved to it instead of dockview's content, silently swallowing the drop", async ({ page }) => {
	await dockViaClick(page);
	await expect(groups(page)).toHaveCount(1);

	const glyph = activityGlyph(page);
	const content = groupContent(page, 0);
	const contentBox = (await content.boundingBox())!;
	const sourceBox = (await glyph.boundingBox())!;
	const tx = contentBox.x + contentBox.width * 0.1;
	const ty = contentBox.y + contentBox.height * 0.5;

	await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 10, sourceBox.y + sourceBox.height / 2 + 10, { steps: 5 });
	await page.mouse.move(tx, ty, { steps: 20 });
	await page.mouse.move(tx, ty); // second sample at rest -- Playwright's own dragover note, and our idle-velocity gate, both need it

	// The real regression, caught mid-drag while the mouse is still down and
	// the Ruler overlay is actually showing: the drop point must hit-test to
	// dockview's own content, never the Ruler's positioning div.
	const hitDuringDrag = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? null, [tx, ty] as const);
	expect(hitDuringDrag).not.toContain("dock-ruler");

	await page.mouse.up();

	await expect(groups(page)).toHaveCount(2); // the actual bug: this silently stayed at 1
	await expect(tabs(page)).toHaveCount(2);
	await expectNoStrayRulerArtifacts(page);
});

test("22. Real mouse drag also works for a second Window's second dock, not just Window 0's", async ({ page }) => {
	await dockViaClick(page);
	await page.getByRole("button", { name: "New Window" }).click();
	await realMouseDrag(page, activityGlyph(page), page.locator(".dv-dockview"));
	await expect(groups(page)).toHaveCount(1);

	await realMouseDrag(page, activityGlyph(page), groupContent(page, 0), { x: 0.9, y: 0.5 });
	await expect(groups(page)).toHaveCount(2);
	await expect(tabs(page)).toHaveCount(2);
	await expectNoStrayRulerArtifacts(page);
});

/**
 * Regression tests filed red-first for two real, reported bugs (screenshots,
 * not inferred): the Dock Ruler's own frame mark doesn't line up with its
 * in-content shade, and two freshly-split panes show no gutter between
 * them. Neither has an existing assertion anywhere in this matrix -- every
 * scenario above either doesn't check the Ruler's cross-element geometry at
 * all, or (for the gutter) only checks it in 2 of 22 scenarios, neither of
 * which is this exact "one pane, drag-split into two" shape.
 */

test("23. Two side-by-side panes from a plain edge drag keep the Spaced theme's own gutter between them", async ({ page }) => {
	await dockViaClick(page);
	const original = groupContent(page, 0);
	await dockViaDrag(page, original, 0.9, 0.5); // -> two side by side, exactly the reported screenshot's own shape

	await expect(groups(page)).toHaveCount(2);
	const [left, right] = (await groupBoxes(page)).sort((a, b) => a.x - b.x);
	// The two content areas' own facing edges, not the group boxes' (which
	// include each one's own tab strip/border -- the gutter is the gap
	// between the two boxes themselves, already what groupBoxes reads).
	const gap = right!.x - (left!.x + left!.width);
	expect(Math.abs(gap - SPACED_THEME_GUTTER_PX)).toBeLessThan(4);
});

test("23b. (dark mode) the gutter is geometrically present but must also be VISIBLE -- .dv-shell (the gutter's own fill) must differ from a pane's own background, not just exist as a gap", async ({ page }) => {
	await page.evaluate(() => localStorage.setItem("zodiac.theme", "dark"));
	await page.reload();
	await expect(page.getByRole("navigation", { name: "Window Carousel" })).toBeVisible();

	await dockViaClick(page);
	await dockViaDrag(page, groupContent(page, 0), 0.9, 0.5);
	await expect(groups(page)).toHaveCount(2);

	const colors = await page.evaluate(() => ({
		shell: getComputedStyle(document.querySelector(".dv-shell")!).backgroundColor,
		content: getComputedStyle(document.querySelector(".dv-content-container")!).backgroundColor,
	}));
	// The actual reported bug: these were identical (rgb(30,30,30) both), so
	// the geometrically-real 10px gutter painted the exact same color as the
	// panes on either side of it -- invisible, not just narrow.
	expect(colors.shell).not.toBe(colors.content);
});

test("24. Dock Ruler: the frame's own live mark lines up with the in-content shade's own split boundary", async ({ page }) => {
	await dockViaClick(page);
	const content = groupContent(page, 0);
	const box = (await content.boundingBox())!;
	const quarterX = box.x + box.width / 4;
	const midY = box.y + box.height / 2;

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await activityGlyph(page).dispatchEvent("dragstart", { dataTransfer });
	await content.dispatchEvent("dragenter", { dataTransfer, clientX: quarterX, clientY: midY });
	await content.dispatchEvent("dragover", { dataTransfer, clientX: quarterX, clientY: midY });
	await content.dispatchEvent("dragover", { dataTransfer, clientX: quarterX, clientY: midY });
	await expect(page.getByText("1/4").first()).toBeVisible();

	// The shade's own boundary: docking left, its right edge is the split
	// line; the shade always starts flush with the group's own left edge in
	// that case, so its right edge is left + width.
	const shadeBox = (await page.getByTestId("dock-ruler-shade").first().boundingBox())!;
	const shadeBoundaryX = shadeBox.x + shadeBox.width;

	// The frame's own live mark, in the same page-space coordinates.
	const markBox = (await page.getByTestId("dock-ruler-mark").first().boundingBox())!;
	const markX = markBox.x;

	expect(Math.abs(markX - shadeBoundaryX)).toBeLessThan(2);

	await activityGlyph(page).dispatchEvent("dragend", { dataTransfer });
});

// Real-mouse variants of 23/24 -- dispatchEvent is a single scripted JS tick
// per event, so it can't reproduce a timing/staleness race a genuinely
// continuous drag might. Same invariants, driven by real page.mouse motion.

test("25. (real mouse) Two side-by-side panes from a plain edge drag keep the Spaced theme's own gutter between them", async ({ page }) => {
	await dockViaClick(page);
	const original = groupContent(page, 0);
	await realMouseDrag(page, activityGlyph(page), original, { x: 0.9, y: 0.5 });

	await expect(groups(page)).toHaveCount(2);
	const [left, right] = (await groupBoxes(page)).sort((a, b) => a.x - b.x);
	const gap = right!.x - (left!.x + left!.width);
	expect(Math.abs(gap - SPACED_THEME_GUTTER_PX)).toBeLessThan(4);
});

test("26. (real mouse) Dock Ruler: the frame's own live mark lines up with the in-content shade's own split boundary, sampled mid-drag", async ({ page }) => {
	await dockViaClick(page);
	const content = groupContent(page, 0);
	const box = (await content.boundingBox())!;
	const sourceBox = (await activityGlyph(page).boundingBox())!;
	const tx = box.x + box.width / 4;
	const ty = box.y + box.height / 2;

	await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 10, sourceBox.y + sourceBox.height / 2 + 10, { steps: 5 });
	await page.mouse.move(tx, ty, { steps: 20 });
	await page.mouse.move(tx, ty);
	await expect(page.getByText("1/4").first()).toBeVisible();

	const shadeBox = (await page.getByTestId("dock-ruler-shade").first().boundingBox())!;
	const shadeBoundaryX = shadeBox.x + shadeBox.width;
	const markBox = (await page.getByTestId("dock-ruler-mark").first().boundingBox())!;

	expect(Math.abs(markBox.x - shadeBoundaryX)).toBeLessThan(2);

	await page.mouse.up();
});

test("24b. dockview's own native per-group content overlay (.dv-drop-target-content) must stay hidden while the Dock Ruler is active -- it carries .dv-drop-target-anchor too, so it's exempted by the same rule that deliberately keeps the ROOT-level edge overlay visible mid-drag, and shows its own independently-computed quadrant preview instead of agreeing with the Ruler", async ({ page }) => {
	await dockViaClick(page);
	const content = groupContent(page, 0);
	const box = (await content.boundingBox())!;
	const quarterX = box.x + box.width / 4; // comfortably off-center, well past the Ruler's own small dead-zone -- not near any root edge
	const midY = box.y + box.height / 2;

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	await activityGlyph(page).dispatchEvent("dragstart", { dataTransfer });
	await content.dispatchEvent("dragenter", { dataTransfer, clientX: quarterX, clientY: midY });
	await content.dispatchEvent("dragover", { dataTransfer, clientX: quarterX, clientY: midY });
	await content.dispatchEvent("dragover", { dataTransfer, clientX: quarterX, clientY: midY });
	await expect(page.getByTestId("dock-ruler-shade")).toBeVisible(); // our own Ruler IS active for this hover

	await expect(page.locator(".dv-drop-target-content")).toBeHidden();

	await activityGlyph(page).dispatchEvent("dragend", { dataTransfer });
});

test("27. Matches the exact reported screenshot's own shape: 3 tabs stacked into one group by repeated click-to-dock, then a 4th split off into a second group -- still keeps the gutter", async ({ page }) => {
	await dockViaClick(page);
	await activityGlyph(page).click();
	await activityGlyph(page).click();
	await expect(groups(page)).toHaveCount(1);
	await expect(tabs(page)).toHaveCount(3);

	await dockViaDrag(page, groupContent(page, 0), 0.9, 0.5);
	await expect(groups(page)).toHaveCount(2);
	await expect(tabs(page)).toHaveCount(4);

	const [left, right] = (await groupBoxes(page)).sort((a, b) => a.x - b.x);
	const gap = right!.x - (left!.x + left!.width);
	expect(Math.abs(gap - SPACED_THEME_GUTTER_PX)).toBeLessThan(4);
});

interface ZoneReading {
	readonly testId: string;
	readonly peak: number;
	readonly borderColor: string;
}

async function readZones(page: Page): Promise<ZoneReading[]> {
	return page.evaluate(() =>
		Array.from(document.querySelectorAll('[data-testid^="drop-zone-"]')).map((element) => ({
			testId: element.getAttribute("data-testid")!,
			peak: Number.parseFloat((element as HTMLElement).style.getPropertyValue("--zone-max-opacity")),
			borderColor: getComputedStyle(element).borderColor,
		})),
	);
}

/** Our own ambient proximity layer's plain native dragover listener is bound to this wrapper specifically (see WindowDockview.tsx) -- dispatching directly on it, rather than a descendant relying on bubbling, is what dockViaDrag's own descendant-targeted events do for dockview's own listeners. */
function windowWrapper(page: Page): Locator {
	return page.locator('[data-testid="window-dockview-wrapper"]');
}

test("28. Smart proximity drop zones: every possible position renders, faint by default, greyscale only, even before anything is docked", async ({ page }) => {
	const wrapper = windowWrapper(page);
	const box = (await dockCanvas(page).boundingBox())!;
	const nearLeftX = box.x + box.width * 0.05;
	const midY = box.y + box.height * 0.5;

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	const glyph = activityGlyph(page);
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await wrapper.dispatchEvent("dragenter", { dataTransfer, clientX: nearLeftX, clientY: midY });
	await wrapper.dispatchEvent("dragover", { dataTransfer, clientX: nearLeftX, clientY: midY });
	await wrapper.dispatchEvent("dragover", { dataTransfer, clientX: nearLeftX, clientY: midY });

	const zones = await readZones(page);
	// Nothing is docked yet -- only the 4 whole-canvas root edges exist as candidates, but they must still all be there ("every possible position"), not just the one closest to the pointer.
	expect(zones.map((zone) => zone.testId).sort()).toEqual(["drop-zone-root:bottom", "drop-zone-root:left", "drop-zone-root:right", "drop-zone-root:top"]);
	for (const zone of zones) {
		const [r, g, b] = zone.borderColor.match(/\d+/g)!.map(Number);
		expect(r).toBe(g); // strictly greyscale -- no accent hue anywhere
		expect(g).toBe(b);
	}

	const left = zones.find((zone) => zone.testId === "drop-zone-root:left")!;
	const right = zones.find((zone) => zone.testId === "drop-zone-root:right")!;
	expect(left.peak).toBeGreaterThan(right.peak); // the pointer sits near the left edge -- it should read far warmer than the opposite side
	expect(right.peak).toBeCloseTo(0.06, 2); // the far side rests at the faint floor, not fully invisible

	await glyph.dispatchEvent("dragend", { dataTransfer });
});

test("29. Smart proximity drop zones: docking one pane adds its own 5 positions (4 edges + center), and whichever is closest breathes brighter", async ({ page }) => {
	await dockViaClick(page);
	const wrapper = windowWrapper(page);
	const box = (await groupContent(page, 0).boundingBox())!;
	const nearLeftX = box.x + box.width * 0.05;
	const midY = box.y + box.height * 0.5;

	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	const glyph = activityGlyph(page);
	await glyph.dispatchEvent("dragstart", { dataTransfer });
	await wrapper.dispatchEvent("dragenter", { dataTransfer, clientX: nearLeftX, clientY: midY });
	await wrapper.dispatchEvent("dragover", { dataTransfer, clientX: nearLeftX, clientY: midY });
	await wrapper.dispatchEvent("dragover", { dataTransfer, clientX: nearLeftX, clientY: midY });

	const zones = await readZones(page);
	const rootZones = zones.filter((zone) => zone.testId.startsWith("drop-zone-root:"));
	const groupZones = zones.filter((zone) => !zone.testId.startsWith("drop-zone-root:"));
	expect(rootZones).toHaveLength(4);
	expect(groupZones).toHaveLength(5); // left/right/top/bottom/center for the one real docked group

	const groupLeft = groupZones.find((zone) => zone.testId.endsWith(":left"))!;
	const groupRight = groupZones.find((zone) => zone.testId.endsWith(":right"))!;
	expect(groupLeft.peak).toBeGreaterThan(groupRight.peak); // pointer near the pane's own left edge

	await glyph.dispatchEvent("dragend", { dataTransfer });
});
