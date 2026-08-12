/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DockRuler } from "./DockRuler.js";

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
		expect(shade.className).toMatch(/bg-gray-500|bg-gray-400/);
	});
});
