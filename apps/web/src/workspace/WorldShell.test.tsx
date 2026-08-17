/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { panelId } from "@zodiac/protocol";
import type { Panel } from "@zodiac/protocol";
import { WorldShell } from "./WorldShell.js";

afterEach(cleanup);

function panel(overrides: Partial<Panel> & Pick<Panel, "location" | "thickness">): Panel {
	return { id: panelId("p1"), alignment: "center", offset: 0, lengthMode: "fill", visibilityMode: "normal", startCap: null, endCap: null, body: [], ...overrides };
}

describe("WorldShell", () => {
	it("always renders the center children, with no edge Panels or slots at all", () => {
		render(<WorldShell panels={[]}>{"canvas"}</WorldShell>);
		expect(screen.getByText("canvas")).toBeInTheDocument();
	});

	it("renders each edge slot only when content is passed for it", () => {
		render(
			<WorldShell panels={[]} left={<nav aria-label="Left" />}>
				content
			</WorldShell>,
		);
		expect(screen.getByRole("navigation", { name: "Left" })).toBeInTheDocument();
		expect(screen.queryByRole("navigation", { name: "Right" })).not.toBeInTheDocument();
	});

	it("defaults an edge's grid track to auto with no Panel there, even when content is passed", () => {
		render(
			<WorldShell panels={[]} left={<nav aria-label="Left" />}>
				content
			</WorldShell>,
		);
		const shell = screen.getByTestId("world-shell");
		expect(shell.style.gridTemplateColumns).toBe("auto 1fr auto");
	});

	it("uses a real Panel's own thickness as that edge's reserved track size", () => {
		const leftPanel = panel({ location: "left", thickness: 72 });
		render(
			<WorldShell panels={[leftPanel]} left={<nav aria-label="Left" />}>
				content
			</WorldShell>,
		);
		const shell = screen.getByTestId("world-shell");
		expect(shell.style.gridTemplateColumns).toBe("72px 1fr auto");
	});

	it("sizes top/bottom rows the same way, independently of left/right columns", () => {
		const topPanel = panel({ location: "top", thickness: 40 });
		const bottomPanel = panel({ location: "bottom", thickness: 24 });
		render(
			<WorldShell panels={[topPanel, bottomPanel]} top={<div>Top</div>} bottom={<div>Bottom</div>}>
				content
			</WorldShell>,
		);
		const shell = screen.getByTestId("world-shell");
		expect(shell.style.gridTemplateRows).toBe("40px 1fr 24px");
	});

	it("ignores a Panel at a Location with no corresponding slot content", () => {
		const rightPanel = panel({ location: "right", thickness: 90 });
		render(<WorldShell panels={[rightPanel]}>content</WorldShell>);
		// The track size still reflects the real Panel even with nothing rendered there --
		// reserved space is a property of the Panel, not conditional on a slot being filled.
		const shell = screen.getByTestId("world-shell");
		expect(shell.style.gridTemplateColumns).toBe("auto 1fr 90px");
	});
});
