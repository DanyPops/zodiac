import { describe, expect, it } from "vitest";
import { clampShapeSettings, clampShapeValue, cornerRadiusPx, DEFAULT_SHAPE_SETTINGS, isShapeSettings, lineWidthPx } from "./shape-settings.js";

describe("Shape settings formulas", () => {
	it("clamps out-of-range and non-finite values into 0-100", () => {
		expect(clampShapeValue(150)).toBe(100);
		expect(clampShapeValue(-10)).toBe(0);
		expect(clampShapeValue(Number.NaN)).toBe(0);
		expect(clampShapeSettings({ strokeWidth: -5, cornerRadius: 200 })).toEqual({ strokeWidth: 0, cornerRadius: 100 });
	});

	it("the shipped default renders identically to the pre-Shape-settings look", () => {
		// strokeWidth 100 -> 1px matches Tailwind's default `border` width;
		// cornerRadius 50 -> 16px matches the `rounded-2xl` value the shell
		// shipped with before this feature existed. Turning the feature on must
		// not change anything visually until a user actually moves a slider.
		expect(lineWidthPx(DEFAULT_SHAPE_SETTINGS.strokeWidth)).toBe(1);
		expect(cornerRadiusPx(DEFAULT_SHAPE_SETTINGS.cornerRadius)).toBe(16);
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
		expect(isShapeSettings({ strokeWidth: 10, cornerRadius: 20 })).toBe(true);
		expect(isShapeSettings({ strokeWidth: "10", cornerRadius: 20 })).toBe(false);
		expect(isShapeSettings({ strokeWidth: 10 })).toBe(false);
		expect(isShapeSettings(null)).toBe(false);
		expect(isShapeSettings(Number.NaN)).toBe(false);
	});
});
