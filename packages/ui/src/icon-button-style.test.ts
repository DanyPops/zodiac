import { describe, expect, it } from "vitest";
import { iconButtonClassName } from "./icon-button-style.js";

describe("iconButtonClassName", () => {
	it("uses the shared --app-corner-radius token, not a fixed rounded-md", () => {
		const className = iconButtonClassName({});
		expect(className).toContain("rounded-[var(--app-corner-radius");
		expect(className).not.toMatch(/(?<!:)rounded-md/);
	});

	it("is always legibly visible with a hover highlight, unlike Glyph Badge's muted idle state", () => {
		const className = iconButtonClassName({});
		expect(className).toContain("text-gray-600");
		expect(className).toContain("hover:bg-gray-200");
	});

	it("the dashed variant is an empty add-new slot, not a solid hover-filled button", () => {
		const className = iconButtonClassName({ dashed: true });
		expect(className).toContain("border-dashed");
		expect(className).not.toContain("hover:bg-gray-200");
	});

	it("shares the same size scale as Glyph Badge", () => {
		expect(iconButtonClassName({ size: "sm" })).toContain("size-6");
		expect(iconButtonClassName({ size: "md" })).toContain("size-7");
		expect(iconButtonClassName({ size: "xl" })).toContain("size-8");
		expect(iconButtonClassName({ size: "lg" })).toContain("size-9");
	});
});
