import { describe, expect, it } from "vitest";
import { applyDragDelta, computeDragDelta } from "./chat-drag.js";

describe("computeDragDelta", () => {
	it("is zero when the pointer hasn't moved", () => {
		expect(computeDragDelta({ clientX: 10, clientY: 20 }, { clientX: 10, clientY: 20 })).toEqual({ x: 0, y: 0 });
	});

	it("reports the signed pointer movement in each axis independently", () => {
		expect(computeDragDelta({ clientX: 10, clientY: 20 }, { clientX: 40, clientY: 5 })).toEqual({ x: 30, y: -15 });
	});
});

describe("applyDragDelta", () => {
	it("adds the delta onto the base position", () => {
		expect(applyDragDelta({ x: 100, y: 50 }, { x: 30, y: -15 })).toEqual({ x: 130, y: 35 });
	});

	it("a zero delta leaves the base position unchanged", () => {
		expect(applyDragDelta({ x: 100, y: 50 }, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
	});
});
