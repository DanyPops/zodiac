import { describe, expect, it } from "vitest";
import { computeWindowFadeOpacity, computeWindowTrackOffsetPx, WINDOW_FADE_DISTANCE, WINDOW_ITEM_HALF_WIDTH_PX, WINDOW_ITEM_STEP_PX } from "./window-carousel-fade.js";

describe("computeWindowTrackOffsetPx", () => {
	it("offsets by exactly half an item's width when the active Window is first", () => {
		expect(computeWindowTrackOffsetPx(0)).toBe(WINDOW_ITEM_HALF_WIDTH_PX);
	});

	it("adds one full item step per Window before the active one", () => {
		expect(computeWindowTrackOffsetPx(3)).toBe(3 * WINDOW_ITEM_STEP_PX + WINDOW_ITEM_HALF_WIDTH_PX);
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
