import { describe, expect, it } from "vitest";
import { isSurfaceFocused } from "./surface-focus.js";

describe("isSurfaceFocused", () => {
	it("is focused when it's the only docked Surface in the Window -- nothing to dim against", () => {
		expect(isSurfaceFocused("a", undefined, 1)).toBe(true);
		expect(isSurfaceFocused("a", "some-other-id", 1)).toBe(true);
	});

	it("is focused when it's the dockview-reported active panel", () => {
		expect(isSurfaceFocused("a", "a", 2)).toBe(true);
	});

	it("is defocused when a sibling Surface is active and more than one is docked", () => {
		expect(isSurfaceFocused("a", "b", 2)).toBe(false);
	});

	it("is focused when no panel is yet reported active (e.g. before dockview's first onDidActivePanelChange) -- never dims speculatively", () => {
		expect(isSurfaceFocused("a", undefined, 2)).toBe(true);
	});
});
