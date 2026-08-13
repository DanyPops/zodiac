import { describe, expect, it } from "vitest";
import { computeDockRulerHint, dockRulerFrameMark, dockRulerGuides, dockRulerHintRect, nearestDockRulerGuide } from "./dock-ruler.js";

describe("dockRulerGuides", () => {
	it("produces every reduced fraction from denominators 2 through 6, deduped", () => {
		const guides = dockRulerGuides();
		const labels = guides.map((guide) => guide.label);
		// 2/4 and 3/6 both reduce to 1/2; 2/6 reduces to 1/3; 4/6 reduces to 2/3 -- none should appear twice.
		expect(labels).toEqual(["1/6", "1/5", "1/4", "1/3", "2/5", "1/2", "3/5", "2/3", "3/4", "4/5", "5/6"]);
	});

	it("sorts ascending by ratio", () => {
		const guides = dockRulerGuides();
		for (let i = 1; i < guides.length; i++) expect(guides[i]!.ratio).toBeGreaterThan(guides[i - 1]!.ratio);
	});

	it("supports a narrower denominator set", () => {
		expect(dockRulerGuides([2]).map((guide) => guide.label)).toEqual(["1/2"]);
	});
});

describe("nearestDockRulerGuide", () => {
	const guides = dockRulerGuides();

	it("finds the exact match", () => {
		expect(nearestDockRulerGuide(0.5, guides).label).toBe("1/2");
	});

	it("finds the closer of two neighbors", () => {
		expect(nearestDockRulerGuide(0.34, guides).label).toBe("1/3"); // 0.333... is closer than 0.4 (2/5)
		expect(nearestDockRulerGuide(0.38, guides).label).toBe("2/5");
	});

	it("clamps out-of-range ratios to the nearest real guide instead of extrapolating", () => {
		expect(nearestDockRulerGuide(-1, guides).label).toBe("1/6");
		expect(nearestDockRulerGuide(2, guides).label).toBe("5/6");
	});
});

describe("computeDockRulerHint", () => {
	const width = 400;
	const height = 200;

	it("real fix for a reported bug: the exact center still resolves to a real 50% split, not a tab dead-zone -- a drop onto the group's own content always splits; tab-insertion is reachable only by dragging onto the group's own header, a structurally different dockview drop target this function never sees", () => {
		expect(computeDockRulerHint(width / 2, height / 2, width, height)).toEqual({ axis: "horizontal", edge: "right", guide: expect.objectContaining({ label: "1/2" }) });
	});

	it("picks the horizontal axis and left side when the pointer is off-center mostly along X", () => {
		const hint = computeDockRulerHint(40, height / 2, width, height); // far left, vertically centered
		expect(hint).toEqual({ axis: "horizontal", edge: "left", guide: expect.objectContaining({ label: "1/6" }) });
	});

	it("picks the horizontal axis and right side past the horizontal midpoint", () => {
		const hint = computeDockRulerHint(360, height / 2, width, height); // far right (ratio 0.9, nearest guide 5/6)
		expect(hint).toEqual({ axis: "horizontal", edge: "right", guide: expect.objectContaining({ label: "5/6" }) });
	});

	it("picks the vertical axis and top side when the pointer is off-center mostly along Y", () => {
		const hint = computeDockRulerHint(width / 2, 20, width, height); // horizontally centered, near top (ratio 0.1)
		expect(hint).toEqual({ axis: "vertical", edge: "top", guide: expect.objectContaining({ label: "1/6" }) });
	});

	it("picks the vertical axis and bottom side past the vertical midpoint", () => {
		const hint = computeDockRulerHint(width / 2, 180, width, height); // ratio 0.9
		expect(hint).toEqual({ axis: "vertical", edge: "bottom", guide: expect.objectContaining({ label: "5/6" }) });
	});

	it("picks whichever axis is more off-center when the pointer isn't aligned to either midline", () => {
		// offsetX/width = 0.1 (0.4 off-center), offsetY/height = 0.4 (0.1 off-center) -- horizontal wins.
		const hint = computeDockRulerHint(40, 80, width, height);
		expect(hint?.axis).toBe("horizontal");
	});

	it("is undefined for a zero-sized target", () => {
		expect(computeDockRulerHint(0, 0, 0, 0)).toBeUndefined();
	});
});

describe("dockRulerHintRect", () => {
	it("docking left: spans from the left edge to the guide's own fraction of the width, full height", () => {
		const rect = dockRulerHintRect({ axis: "horizontal", edge: "left", guide: { ratio: 1 / 4, label: "1/4" } }, 400, 200);
		expect(rect).toEqual({ left: 0, top: 0, width: 100, height: 200 });
	});

	it("docking right: spans from the guide's own fraction to the right edge, full height", () => {
		const rect = dockRulerHintRect({ axis: "horizontal", edge: "right", guide: { ratio: 3 / 4, label: "3/4" } }, 400, 200);
		expect(rect).toEqual({ left: 300, top: 0, width: 100, height: 200 });
	});

	it("docking top: spans from the top edge to the guide's own fraction of the height, full width", () => {
		const rect = dockRulerHintRect({ axis: "vertical", edge: "top", guide: { ratio: 1 / 4, label: "1/4" } }, 400, 200);
		expect(rect).toEqual({ left: 0, top: 0, width: 400, height: 50 });
	});

	it("docking bottom: spans from the guide's own fraction to the bottom edge, full width", () => {
		const rect = dockRulerHintRect({ axis: "vertical", edge: "bottom", guide: { ratio: 3 / 4, label: "3/4" } }, 400, 200);
		expect(rect).toEqual({ left: 0, top: 150, width: 400, height: 50 });
	});
});

describe("dockRulerFrameMark", () => {
	const box = { left: 100, top: 50, width: 400, height: 200 };

	it("projects a horizontal hint onto an absolute page-space X, relative to the target's own left edge", () => {
		const mark = dockRulerFrameMark({ axis: "horizontal", edge: "left", guide: { ratio: 1 / 4, label: "1/4" } }, box);
		expect(mark).toEqual({ axis: "horizontal", position: 200, label: "1/4" }); // 100 + 0.25 * 400
	});

	it("projects a vertical hint onto an absolute page-space Y, relative to the target's own top edge", () => {
		const mark = dockRulerFrameMark({ axis: "vertical", edge: "bottom", guide: { ratio: 3 / 4, label: "3/4" } }, box);
		expect(mark).toEqual({ axis: "vertical", position: 200, label: "3/4" }); // 50 + 0.75 * 200
	});

	it("a nested sub-group's own fraction can legitimately fall between the whole-canvas frame's own reference ticks", () => {
		// A sub-group occupying only the right half of a wider canvas (left: 300) -- its own 1/2 doesn't land on any
		// whole-canvas guide, which is expected: the frame shows a distinct marker, not a snap onto its own grid.
		const subGroupBox = { left: 300, top: 50, width: 200, height: 200 };
		const mark = dockRulerFrameMark({ axis: "horizontal", edge: "left", guide: { ratio: 1 / 2, label: "1/2" } }, subGroupBox);
		expect(mark.position).toBe(400); // 300 + 0.5 * 200 -- not a round fraction of the outer 100..500 canvas
	});
});
