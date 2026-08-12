/** @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GALLERY_CATEGORIES } from "./gallery-categories.js";

describe("GALLERY_CATEGORIES", () => {
	it("every category has a unique id", () => {
		const ids = GALLERY_CATEGORIES.map((category) => category.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("every category has at least one icon and a real title", () => {
		for (const category of GALLERY_CATEGORIES) {
			expect(category.icons.length).toBeGreaterThan(0);
			expect(category.title.trim().length).toBeGreaterThan(0);
		}
	});

	it("every category's renderPreview renders without throwing", () => {
		for (const category of GALLERY_CATEGORIES) {
			expect(() => render(<>{category.renderPreview()}</>)).not.toThrow();
		}
	});

	it("includes every category named in the settled discussion", () => {
		const ids = GALLERY_CATEGORIES.map((category) => category.id);
		for (const expected of ["tickets", "automation", "filesystem", "terminal", "browser", "document-reader", "photo-viewer", "whiteboard"]) {
			expect(ids).toContain(expected);
		}
	});
});
