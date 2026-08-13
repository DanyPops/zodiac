/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DockRuler } from "./DockRuler.js";
import { ACTIVE_ZONE_CEILING_OPACITY, ACTIVE_ZONE_FLOOR_OPACITY } from "./proximity-zones.js";

afterEach(cleanup);

describe("DockRuler", () => {
	it("never intercepts pointer/drag events -- it's a pure visual overlay above the native drag target", () => {
		render(<DockRuler width={400} height={200} hint={{ axis: "horizontal", edge: "left", guide: { ratio: 1 / 3, label: "1/3" } }} />);
		expect(screen.getByTestId("dock-ruler-shade")).toHaveClass("pointer-events-none");
	});

	it("shades from the left edge up to the guide's ratio when docking left", () => {
		render(<DockRuler width={400} height={200} hint={{ axis: "horizontal", edge: "left", guide: { ratio: 1 / 4, label: "1/4" } }} />);
		const shade = screen.getByTestId("dock-ruler-shade");
		expect(shade).toHaveStyle({ left: "0px", width: "100px" }); // 1/4 of 400
	});

	it("shades from the guide's ratio to the right edge when docking right", () => {
		render(<DockRuler width={400} height={200} hint={{ axis: "horizontal", edge: "right", guide: { ratio: 3 / 4, label: "3/4" } }} />);
		const shade = screen.getByTestId("dock-ruler-shade");
		expect(shade).toHaveStyle({ left: "300px", width: "100px" }); // from 3/4 of 400 to the edge
	});

	it("shades from the top edge down to the guide's ratio when docking top", () => {
		render(<DockRuler width={400} height={200} hint={{ axis: "vertical", edge: "top", guide: { ratio: 1 / 4, label: "1/4" } }} />);
		const shade = screen.getByTestId("dock-ruler-shade");
		expect(shade).toHaveStyle({ top: "0px", height: "50px" }); // 1/4 of 200
	});

	it("shades from the guide's ratio to the bottom edge when docking bottom", () => {
		render(<DockRuler width={400} height={200} hint={{ axis: "vertical", edge: "bottom", guide: { ratio: 3 / 4, label: "3/4" } }} />);
		const shade = screen.getByTestId("dock-ruler-shade");
		expect(shade).toHaveStyle({ top: "150px", height: "50px" }); // from 3/4 of 200 to the edge
	});

	it("matches the proximity zones' own neutral greyscale, not accent -- one consolidated ambient visual language, not two conflicting ones", () => {
		render(<DockRuler width={400} height={200} hint={{ axis: "horizontal", edge: "left", guide: { ratio: 1 / 3, label: "1/3" } }} />);
		const shade = screen.getByTestId("dock-ruler-shade");
		expect(shade.className).not.toMatch(/accent/);
		expect(shade.className).toMatch(/border-gray-500|border-gray-400/);
	});

	it("is a border effect, not a solid fill -- a thicker, brighter instance of the same zone-box language, not a competing 'blocky overlay' motif", () => {
		render(<DockRuler width={400} height={200} hint={{ axis: "horizontal", edge: "left", guide: { ratio: 1 / 3, label: "1/3" } }} />);
		const shade = screen.getByTestId("dock-ruler-shade");
		expect(shade.className).toMatch(/\bborder-2\b/);
		expect(shade.className).not.toMatch(/bg-gray-500\/|bg-gray-400\//); // no translucent fill class
	});

	it("rounds its corners with the same shared --app-corner-radius token every other shell shape follows", () => {
		render(<DockRuler width={400} height={200} hint={{ axis: "horizontal", edge: "left", guide: { ratio: 1 / 3, label: "1/3" } }} />);
		expect(screen.getByTestId("dock-ruler-shade").className).toMatch(/rounded-\[var\(--app-corner-radius/);
	});

	it("breathes on the shared animation, brighter than any ambient proximity zone -- it's the one confirmed target, not a proximity guess", () => {
		render(<DockRuler width={400} height={200} hint={{ axis: "horizontal", edge: "left", guide: { ratio: 1 / 3, label: "1/3" } }} />);
		const shade = screen.getByTestId("dock-ruler-shade");
		expect(shade).toHaveClass("animate-zone-breathe");
		expect(shade).toHaveClass("motion-reduce:animate-none");
		expect(shade.style.getPropertyValue("--zone-min-opacity")).toBe(String(ACTIVE_ZONE_FLOOR_OPACITY));
		expect(shade.style.getPropertyValue("--zone-max-opacity")).toBe(String(ACTIVE_ZONE_CEILING_OPACITY));
	});
});
