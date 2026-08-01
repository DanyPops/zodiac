import { describe, expect, it } from "vitest";
import { circularWindowDelta, computeWindowFadeOpacity, computeWindowOffsetPx, WINDOW_FADE_DISTANCE, WINDOW_ITEM_STEP_PX } from "./window-carousel-fade.js";

describe("circularWindowDelta", () => {
	it("is 0 for the active Window itself", () => {
		expect(circularWindowDelta(3, 3, 7)).toBe(0);
	});

	it("is a plain signed difference when nowhere near the wrap boundary", () => {
		expect(circularWindowDelta(4, 3, 7)).toBe(1);
		expect(circularWindowDelta(1, 3, 7)).toBe(-2);
	});

	it("wraps: the last Window is one step *before* the first, not maximally far away", () => {
		expect(circularWindowDelta(6, 0, 7)).toBe(-1);
	});

	it("wraps: the first Window is one step *after* the last", () => {
		expect(circularWindowDelta(0, 6, 7)).toBe(1);
	});

	it("is symmetric: swapping index and activeIndex negates the delta", () => {
		expect(circularWindowDelta(6, 0, 7)).toBe(-circularWindowDelta(0, 6, 7));
	});

	it("returns 0 for a non-positive Window count -- nothing to wrap around", () => {
		expect(circularWindowDelta(0, 0, 0)).toBe(0);
	});
});

describe("computeWindowOffsetPx", () => {
	it("is 0 at the active Window (delta 0)", () => {
		expect(computeWindowOffsetPx(0)).toBe(0);
	});

	it("scales linearly with delta, signed", () => {
		expect(computeWindowOffsetPx(2)).toBe(2 * WINDOW_ITEM_STEP_PX);
		expect(computeWindowOffsetPx(-1)).toBe(-WINDOW_ITEM_STEP_PX);
	});
});

describe("computeWindowFadeOpacity", () => {
	it("is fully opaque at the active Window itself", () => {
		expect(computeWindowFadeOpacity(0)).toBe(1);
	});

	it("fades linearly between the active Window and the fade distance", () => {
		expect(computeWindowFadeOpacity(1)).toBeCloseTo(1 - 1 / WINDOW_FADE_DISTANCE);
		expect(computeWindowFadeOpacity(2)).toBeCloseTo(1 - 2 / WINDOW_FADE_DISTANCE);
	});

	it("is fully invisible at exactly the fade distance", () => {
		expect(computeWindowFadeOpacity(WINDOW_FADE_DISTANCE)).toBe(0);
	});

	it("clamps to invisible, never negative, past the fade distance", () => {
		expect(computeWindowFadeOpacity(WINDOW_FADE_DISTANCE + 5)).toBe(0);
	});

	it("treats distance as unsigned -- a Window before or after the active one fades the same way", () => {
		expect(computeWindowFadeOpacity(-2)).toBe(computeWindowFadeOpacity(2));
	});
});
