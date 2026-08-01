import { describe, expect, it } from "vitest";
import { computeWispCursorStyle } from "./wisp-cursor.js";

const ANCHOR = { x: 100, y: 200 };

describe("computeWispCursorStyle", () => {
	it("is fully transparent when not visible, regardless of target", () => {
		expect(computeWispCursorStyle({ visible: false }, ANCHOR).opacity).toBe(0);
		expect(computeWispCursorStyle({ visible: false, target: { x: 1, y: 2 } }, ANCHOR).opacity).toBe(0);
	});

	it("is fully opaque and idle at the anchor when visible with no target", () => {
		const style = computeWispCursorStyle({ visible: true }, ANCHOR);
		expect(style.opacity).toBe(1);
		expect(style.idle).toBe(true);
		expect(style.transform).toBe("translate(100px, 200px)");
	});

	it("drifts to the target and stops idling once one is set", () => {
		const style = computeWispCursorStyle({ visible: true, target: { x: 42, y: 7 } }, ANCHOR);
		expect(style.opacity).toBe(1);
		expect(style.idle).toBe(false);
		expect(style.transform).toBe("translate(42px, 7px)");
	});

	it("reflects a different anchor when idle, not a hardcoded origin", () => {
		const style = computeWispCursorStyle({ visible: true }, { x: -10, y: 5 });
		expect(style.transform).toBe("translate(-10px, 5px)");
	});
});
