import { describe, expect, it } from "vitest";
import { WORKSPACE_CATALOG } from "./workspace-catalog.js";

describe("Workspace catalog", () => {
	it("declares at least one entry with unique, non-empty ids and titles", () => {
		expect(WORKSPACE_CATALOG.length).toBeGreaterThan(0);
		const ids = WORKSPACE_CATALOG.map((entry) => entry.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const entry of WORKSPACE_CATALOG) {
			expect(entry.id.length).toBeGreaterThan(0);
			expect(entry.title.length).toBeGreaterThan(0);
		}
	});

	it("gives every entry a distinct glyph icon, not a shared placeholder", () => {
		const icons = WORKSPACE_CATALOG.map((entry) => entry.icon);
		expect(new Set(icons).size).toBe(icons.length);
	});
});
