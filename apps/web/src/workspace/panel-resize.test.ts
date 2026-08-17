import { describe, expect, it } from "vitest";
import { nearestPanelThickness, PANEL_RESIZE_SNAP_POINTS } from "./panel-resize.js";

describe("nearestPanelThickness", () => {
	it("snaps to the collapsed width when the candidate is closer to it", () => {
		expect(nearestPanelThickness(80)).toBe(56);
	});

	it("snaps to the expanded width when the candidate is closer to it", () => {
		expect(nearestPanelThickness(200)).toBe(256);
	});

	it("snaps to whichever point is nearest at the exact midpoint's own boundary, deterministically (first strictly-closer point wins, not a tie)", () => {
		const midpoint = (PANEL_RESIZE_SNAP_POINTS[0]! + PANEL_RESIZE_SNAP_POINTS[1]!) / 2;
		expect(nearestPanelThickness(midpoint)).toBe(PANEL_RESIZE_SNAP_POINTS[0]);
	});

	it("never returns a value outside the given snap points, however far the candidate drags", () => {
		expect(nearestPanelThickness(-500)).toBe(56);
		expect(nearestPanelThickness(10_000)).toBe(256);
	});

	it("supports a caller-supplied snap set instead of the default two", () => {
		expect(nearestPanelThickness(95, [50, 100, 150])).toBe(100);
	});
});
