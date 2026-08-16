import { describe, expect, it } from "vitest";
import { pillClassName } from "./pill-style.js";

describe("pillClassName", () => {
	it("merges the shared pill shape with Gradient to Contrast's surface fill", () => {
		const className = pillClassName();
		expect(className).toContain("rounded-[var(--app-corner-radius");
		expect(className).toContain("bg-white");
		expect(className).toContain("dark:bg-gray-800");
	});

	it("merges a caller's own extra className", () => {
		expect(pillClassName("custom-pill")).toContain("custom-pill");
	});
});
