/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DockRulerFrame } from "./DockRulerFrame.js";
import { dockRulerGuides } from "./dock-ruler.js";

const GUIDE_COUNT = dockRulerGuides().length;
const BOX = { left: 100, top: 50, width: 400, height: 200 };

afterEach(cleanup);

describe("DockRulerFrame", () => {
	it("renders nothing while not visible, even with a box and mark", () => {
		const { container } = render(<DockRulerFrame visible={false} box={BOX} mark={{ axis: "horizontal", position: 200, label: "1/4" }} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing when visible but the canvas box hasn't been measured yet", () => {
		const { container } = render(<DockRulerFrame visible box={undefined} mark={undefined} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("wraps the dock area with four bars -- above, below, left, and right of the canvas box, none inside it", () => {
		render(<DockRulerFrame visible box={BOX} mark={undefined} />);
		const bars = screen.getAllByTestId("dock-ruler-bar");
		expect(bars).toHaveLength(4);
		expect(bars.map((bar) => bar.style.top)).toEqual(expect.arrayContaining(["22px", "250px", "50px"])); // above (50-28), below (50+200), and the two side bars share top:50px
		expect(bars.map((bar) => bar.style.left)).toEqual(expect.arrayContaining(["100px", "72px", "500px"])); // top/bottom bars at left:100px, left side bar at 100-28, right side bar at 100+400
	});

	it("every bar shows the full reference guide set even with no live mark yet", () => {
		render(<DockRulerFrame visible box={BOX} mark={undefined} />);
		expect(screen.getAllByTestId("dock-ruler-bar")[0]!.querySelectorAll("span").length).toBe(GUIDE_COUNT);
		expect(screen.queryByTestId("dock-ruler-mark")).not.toBeInTheDocument();
	});

	it("highlights a live mark only on the bars matching its own axis", () => {
		render(<DockRulerFrame visible box={BOX} mark={{ axis: "horizontal", position: 200, label: "1/4" }} />);
		// Two horizontal bars (above/below) get the mark; the two vertical (side) bars don't.
		expect(screen.getAllByTestId("dock-ruler-mark")).toHaveLength(2);
		expect(screen.getAllByText("1/4")).toHaveLength(2);
	});

	it("places a horizontal mark at the page-space X offset, relative to the box's own left edge", () => {
		render(<DockRulerFrame visible box={BOX} mark={{ axis: "horizontal", position: 200, label: "1/4" }} />);
		const marks = screen.getAllByTestId("dock-ruler-mark");
		expect(marks[0]).toHaveStyle({ left: "100px" }); // 200 - box.left(100)
	});

	it("places a vertical mark at the page-space Y offset, relative to the box's own top edge", () => {
		render(<DockRulerFrame visible box={BOX} mark={{ axis: "vertical", position: 200, label: "3/4" }} />);
		const marks = screen.getAllByTestId("dock-ruler-mark");
		expect(marks).toHaveLength(2); // the two vertical (side) bars only
		expect(marks[0]).toHaveStyle({ top: "150px" }); // 200 - box.top(50)
	});

	it("is a pure visual overlay -- never intercepts pointer/drag events", () => {
		render(<DockRulerFrame visible box={BOX} mark={{ axis: "horizontal", position: 200, label: "1/4" }} />);
		for (const bar of screen.getAllByTestId("dock-ruler-bar")) expect(bar).toHaveClass("pointer-events-none");
	});
});
