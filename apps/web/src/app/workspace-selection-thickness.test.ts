import { describe, expect, it } from "vitest";
import { COLLAPSED_WORKSPACE_SELECTION_THICKNESS, resolveWorkspaceSelectionThickness } from "./workspace-selection-thickness.js";

describe("resolveWorkspaceSelectionThickness", () => {
	it("collapsing always resolves to the fixed quick-selection strip width", () => {
		expect(resolveWorkspaceSelectionThickness(true, 256)).toBe(COLLAPSED_WORKSPACE_SELECTION_THICKNESS);
		expect(resolveWorkspaceSelectionThickness(true, 400)).toBe(COLLAPSED_WORKSPACE_SELECTION_THICKNESS);
	});

	it("expanding restores the last observed expanded width, not a fixed default", () => {
		expect(resolveWorkspaceSelectionThickness(false, 256)).toBe(256);
		expect(resolveWorkspaceSelectionThickness(false, 320)).toBe(320);
	});
});
