import { describe, expect, it } from "vitest";
import { clampDnaValue, clampVisualDna, cornerRadiusPx, DEFAULT_VISUAL_DNA, isVisualDna, lineWidthPx } from "./visual-dna.js";

describe("Visual DNA formulas", () => {
	it("clamps out-of-range and non-finite values into 0-100", () => {
		expect(clampDnaValue(150)).toBe(100);
		expect(clampDnaValue(-10)).toBe(0);
		expect(clampDnaValue(Number.NaN)).toBe(0);
		expect(clampVisualDna({ vibe: -5, cornerSharpness: 200 })).toEqual({ vibe: 0, cornerSharpness: 100 });
	});

	it("the shipped default renders identically to the pre-Visual-DNA look", () => {
		// vibe 100 -> 1px matches Tailwind's default `border` width; cornerSharpness
		// 50 -> 16px matches the `rounded-2xl` value the shell shipped with before
		// this feature existed. Turning the feature on must not change anything
		// visually until a user actually moves a slider.
		expect(lineWidthPx(DEFAULT_VISUAL_DNA.vibe)).toBe(1);
		expect(cornerRadiusPx(DEFAULT_VISUAL_DNA.cornerSharpness)).toBe(16);
	});

	it("line width ranges from crisp (Professional) to bold (Cartoon)", () => {
		expect(lineWidthPx(100)).toBe(1);
		expect(lineWidthPx(0)).toBe(3);
		expect(lineWidthPx(50)).toBe(2);
	});

	it("corner radius ranges from Square to a radius that clamps small elements into circles", () => {
		expect(cornerRadiusPx(0)).toBe(0);
		expect(cornerRadiusPx(100)).toBe(32);
	});

	it("validates shape before trusting stored JSON", () => {
		expect(isVisualDna({ vibe: 10, cornerSharpness: 20 })).toBe(true);
		expect(isVisualDna({ vibe: "10", cornerSharpness: 20 })).toBe(false);
		expect(isVisualDna({ vibe: 10 })).toBe(false);
		expect(isVisualDna(null)).toBe(false);
		expect(isVisualDna(Number.NaN)).toBe(false);
	});
});
