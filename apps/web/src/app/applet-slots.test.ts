import { describe, expect, it } from "vitest";
import { appletId, panelId } from "@zodiac/protocol";
import type { Panel } from "@zodiac/protocol";
import { appletIdForLocation } from "./applet-slots.js";

function panel(overrides: Partial<Panel> & Pick<Panel, "location" | "body">): Panel {
	return { id: panelId("p1"), alignment: "start", offset: 0, thickness: 56, thicknessUnit: "px", lengthMode: "fill", visibilityMode: "normal", startCap: null, endCap: null, ...overrides };
}

describe("appletIdForLocation", () => {
	it("defaults left to workspace-nav and right to surface-templates with no Panels at all", () => {
		expect(appletIdForLocation("left", [])).toBe("workspace-nav");
		expect(appletIdForLocation("right", [])).toBe("surface-templates");
	});

	it("has no default for top/bottom -- Web doesn't seed chrome there today", () => {
		expect(appletIdForLocation("top", [])).toBeUndefined();
		expect(appletIdForLocation("bottom", [])).toBeUndefined();
	});

	it("a real Panel's own body wins over the default, e.g. once an agent moves workspace-nav to the right", () => {
		const moved = panel({ location: "right", body: [appletId("workspace-nav")] });
		expect(appletIdForLocation("right", [moved])).toBe("workspace-nav");
		expect(appletIdForLocation("left", [moved])).toBe("workspace-nav"); // no Panel at left -- falls back to left's own default, unaffected by the move
	});

	it("a real Panel with an explicitly emptied body renders nothing -- never falls back to the default", () => {
		const vacated = panel({ location: "left", body: [] });
		expect(appletIdForLocation("left", [vacated])).toBeUndefined();
	});
});
