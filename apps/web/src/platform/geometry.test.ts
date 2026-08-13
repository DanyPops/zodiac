import { describe, expect, it } from "vitest";
import { centroidOf, distanceBetween, splitRect, toLocalRect, type Rect } from "./geometry.js";

function rect(left: number, top: number, width: number, height: number): Rect {
	return { left, top, width, height };
}

describe("centroidOf", () => {
	it("is the rect's own center point", () => {
		expect(centroidOf(rect(10, 20, 100, 50))).toEqual({ x: 60, y: 45 });
	});

	it("is the point itself for a zero-sized rect", () => {
		expect(centroidOf(rect(5, 5, 0, 0))).toEqual({ x: 5, y: 5 });
	});
});

describe("distanceBetween", () => {
	it("is zero for the same point", () => {
		expect(distanceBetween({ x: 3, y: 4 }, { x: 3, y: 4 })).toBe(0);
	});

	it("is the real Euclidean distance", () => {
		expect(distanceBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
	});
});

describe("toLocalRect", () => {
	it("subtracts the container's own top-left corner from the page rect", () => {
		const page = rect(150, 220, 300, 100);
		const container = rect(100, 200, 800, 600);
		expect(toLocalRect(page, container)).toEqual({ left: 50, top: 20, width: 300, height: 100 });
	});

	it("is the identity when the container's own origin is the page origin", () => {
		const page = rect(10, 10, 40, 40);
		expect(toLocalRect(page, rect(0, 0, 999, 999))).toEqual(page);
	});
});

describe("splitRect", () => {
	const box = rect(0, 0, 200, 100);

	it("horizontal, from the start (left), takes ratio of the width off the left edge", () => {
		expect(splitRect(box, "horizontal", true, 0.25)).toEqual({ left: 0, top: 0, width: 50, height: 100 });
	});

	it("horizontal, not from the start (right), takes the remainder after ratio of the width", () => {
		expect(splitRect(box, "horizontal", false, 0.25)).toEqual({ left: 50, top: 0, width: 150, height: 100 });
	});

	it("vertical, from the start (top), takes ratio of the height off the top edge", () => {
		expect(splitRect(box, "vertical", true, 0.4)).toEqual({ left: 0, top: 0, width: 200, height: 40 });
	});

	it("vertical, not from the start (bottom), takes the remainder after ratio of the height", () => {
		expect(splitRect(box, "vertical", false, 0.4)).toEqual({ left: 0, top: 40, width: 200, height: 60 });
	});

	it("preserves a non-zero origin, not just size", () => {
		expect(splitRect(rect(10, 20, 200, 100), "horizontal", false, 0.5)).toEqual({ left: 110, top: 20, width: 100, height: 100 });
	});

	it("a fixed 0.5 ratio is exactly the old groupPositionRect's own 50/50 split", () => {
		expect(splitRect(box, "horizontal", true, 0.5)).toEqual({ left: 0, top: 0, width: 100, height: 100 });
		expect(splitRect(box, "horizontal", false, 0.5)).toEqual({ left: 100, top: 0, width: 100, height: 100 });
	});
});
