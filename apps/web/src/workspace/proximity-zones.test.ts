import { describe, expect, it } from "vitest";
import { ACTIVE_ZONE_CEILING_OPACITY, ACTIVE_ZONE_FLOOR_OPACITY, computeDropZones, dropZoneCloseness, dropZoneOpacity, PROXIMITY_CEILING_OPACITY, PROXIMITY_FLOOR_OPACITY, proximityInfluenceRadius } from "./proximity-zones.js";

const canvasRect = { left: 0, top: 0, width: 800, height: 400 };

describe("computeDropZones", () => {
	it("offers all 5 dockview positions for a single group -- every possible position, even with only one pane", () => {
		const group = { id: "g1", rect: { left: 100, top: 50, width: 400, height: 200 } };
		const zones = computeDropZones([group], canvasRect);
		const groupZones = zones.filter((zone) => zone.groupId === "g1");
		expect(groupZones.map((zone) => zone.position).sort()).toEqual(["bottom", "center", "left", "right", "top"]);
	});

	it("slices a group's left/right zones to half its width, full height", () => {
		const group = { id: "g1", rect: { left: 100, top: 50, width: 400, height: 200 } };
		const zones = computeDropZones([group], canvasRect);
		const left = zones.find((zone) => zone.id === "g1:left")!;
		const right = zones.find((zone) => zone.id === "g1:right")!;
		expect(left.rect).toEqual({ left: 100, top: 50, width: 200, height: 200 });
		expect(right.rect).toEqual({ left: 300, top: 50, width: 200, height: 200 });
	});

	it("slices a group's top/bottom zones to half its height, full width", () => {
		const group = { id: "g1", rect: { left: 100, top: 50, width: 400, height: 200 } };
		const zones = computeDropZones([group], canvasRect);
		const top = zones.find((zone) => zone.id === "g1:top")!;
		const bottom = zones.find((zone) => zone.id === "g1:bottom")!;
		expect(top.rect).toEqual({ left: 100, top: 50, width: 400, height: 100 });
		expect(bottom.rect).toEqual({ left: 100, top: 150, width: 400, height: 100 });
	});

	it("a group's center zone spans the group's own full rect -- dock as a tab", () => {
		const group = { id: "g1", rect: { left: 100, top: 50, width: 400, height: 200 } };
		const zones = computeDropZones([group], canvasRect);
		expect(zones.find((zone) => zone.id === "g1:center")!.rect).toEqual(group.rect);
	});

	it("every zone's centroid is its own rect's geometric center", () => {
		const group = { id: "g1", rect: { left: 0, top: 0, width: 100, height: 100 } };
		const zones = computeDropZones([group], canvasRect);
		const left = zones.find((zone) => zone.id === "g1:left")!;
		expect(left.centroid).toEqual({ x: 25, y: 50 });
	});

	it("adds 4 root (whole-canvas) edge zones regardless of group count", () => {
		const rootIds = computeDropZones([], canvasRect)
			.filter((zone) => zone.groupId === undefined)
			.map((zone) => zone.id)
			.sort();
		expect(rootIds).toEqual(["root:bottom", "root:left", "root:right", "root:top"]);
	});

	it("still offers the 4 root zones with zero groups -- an empty canvas has no group zones but the geometry itself doesn't require one to exist", () => {
		expect(computeDropZones([], canvasRect)).toHaveLength(4);
	});

	it("produces 5 zones per group plus 4 root zones for multiple groups", () => {
		const groups = [
			{ id: "g1", rect: { left: 0, top: 0, width: 400, height: 400 } },
			{ id: "g2", rect: { left: 400, top: 0, width: 400, height: 400 } },
		];
		expect(computeDropZones(groups, canvasRect)).toHaveLength(5 * 2 + 4);
	});

	it("root zones span a fixed fraction of the whole canvas from each of its own edges", () => {
		const zones = computeDropZones([], canvasRect);
		const left = zones.find((zone) => zone.id === "root:left")!;
		const right = zones.find((zone) => zone.id === "root:right")!;
		const top = zones.find((zone) => zone.id === "root:top")!;
		const bottom = zones.find((zone) => zone.id === "root:bottom")!;
		expect(left.rect).toEqual({ left: 0, top: 0, width: 200, height: 400 }); // 25% of 800
		expect(right.rect).toEqual({ left: 600, top: 0, width: 200, height: 400 });
		expect(top.rect).toEqual({ left: 0, top: 0, width: 800, height: 100 }); // 25% of 400
		expect(bottom.rect).toEqual({ left: 0, top: 300, width: 800, height: 100 });
	});
});

describe("proximityInfluenceRadius", () => {
	it("is half the canvas's own diagonal -- resolution-independent, not a fixed pixel constant", () => {
		expect(proximityInfluenceRadius({ left: 0, top: 0, width: 300, height: 400 })).toBe(250); // 3-4-5 triangle * 100, halved
	});
});

describe("dropZoneCloseness", () => {
	const zone = { id: "z", position: "left" as const, rect: { left: 0, top: 0, width: 100, height: 100 }, centroid: { x: 50, y: 50 } };

	it("is 1 exactly at the zone's own centroid", () => {
		expect(dropZoneCloseness({ x: 50, y: 50 }, zone, 200)).toBe(1);
	});

	it("is 0 at or beyond the influence radius", () => {
		expect(dropZoneCloseness({ x: 250, y: 50 }, zone, 200)).toBe(0);
		expect(dropZoneCloseness({ x: 1000, y: 1000 }, zone, 200)).toBe(0);
	});

	it("falls off quadratically, not linearly -- half the radius away is a quarter as close, not half", () => {
		expect(dropZoneCloseness({ x: 150, y: 50 }, zone, 200)).toBeCloseTo(0.25, 5);
	});

	it("decreases monotonically as distance grows", () => {
		const near = dropZoneCloseness({ x: 70, y: 50 }, zone, 200);
		const far = dropZoneCloseness({ x: 120, y: 50 }, zone, 200);
		expect(near).toBeGreaterThan(far);
	});

	it("is 0 for a non-positive influence radius rather than dividing by zero", () => {
		expect(dropZoneCloseness({ x: 50, y: 50 }, zone, 0)).toBe(0);
	});
});

describe("dropZoneOpacity", () => {
	it("maps closeness 0 to the faint floor -- every possible position stays visible, never fully invisible", () => {
		expect(dropZoneOpacity(0)).toBe(PROXIMITY_FLOOR_OPACITY);
	});

	it("maps closeness 1 to the bright ceiling", () => {
		expect(dropZoneOpacity(1)).toBeCloseTo(PROXIMITY_CEILING_OPACITY, 10);
	});

	it("interpolates linearly between floor and ceiling for a mid closeness", () => {
		expect(dropZoneOpacity(0.5)).toBeCloseTo((PROXIMITY_FLOOR_OPACITY + PROXIMITY_CEILING_OPACITY) / 2, 5);
	});
});

describe("the active (Dock Ruler) zone's own breathing range", () => {
	it("never dims as low as an ambient zone's own floor -- it's a confirmed target, not a proximity guess", () => {
		expect(ACTIVE_ZONE_FLOOR_OPACITY).toBeGreaterThan(PROXIMITY_FLOOR_OPACITY);
	});

	it("peaks at least as bright as the brightest ambient zone ever gets", () => {
		expect(ACTIVE_ZONE_CEILING_OPACITY).toBeGreaterThanOrEqual(PROXIMITY_CEILING_OPACITY);
	});
});
