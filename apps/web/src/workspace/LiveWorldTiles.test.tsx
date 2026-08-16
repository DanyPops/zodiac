/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { integrationId, surfaceId, windowId, workspaceId } from "@zodiac/protocol";
import type { WorldViewModel } from "@zodiac/protocol";
import { LiveWorldTiles } from "./LiveWorldTiles.js";

afterEach(() => {
	cleanup();
});

describe("LiveWorldTiles", () => {
	it("renders an unavailable message while disconnected, regardless of viewModel content", () => {
		render(<LiveWorldTiles connected={false} viewModel={{ state: "empty", workspaces: [], activeWorkspaceId: null }} />);
		expect(screen.getByTestId("live-world-tiles")).toHaveAttribute("data-state", "disconnected");
	});

	it("renders an empty-world message once connected to a daemon with no open Workspace", () => {
		render(<LiveWorldTiles connected viewModel={{ state: "empty", workspaces: [], activeWorkspaceId: null }} />);
		expect(screen.getByTestId("live-world-tiles")).toHaveAttribute("data-state", "empty");
	});

	it("renders a no-surfaces message for an open Workspace with nothing docked", () => {
		const viewModel: WorldViewModel = {
			state: "ready",
			activeWorkspaceId: workspaceId("w1"),
			workspaces: [{ id: workspaceId("w1"), title: "Bug Triage", activeWindowId: windowId("win1"), windows: [{ id: windowId("win1"), title: "Window 1", active: true, surfaces: [], tile: null }] }],
		};
		render(<LiveWorldTiles connected viewModel={viewModel} />);
		const el = screen.getByTestId("live-world-tiles");
		expect(el).toHaveAttribute("data-state", "no-surfaces");
		expect(el.textContent).toContain("Bug Triage");
	});

	it("renders one positioned, titled box per docked Surface, projected through the same computeTileRects geometry the TUI uses", () => {
		const viewModel: WorldViewModel = {
			state: "ready",
			activeWorkspaceId: workspaceId("w1"),
			workspaces: [
				{
					id: workspaceId("w1"),
					title: "Bug Triage",
					activeWindowId: windowId("win1"),
					windows: [
						{
							id: windowId("win1"),
							title: "Window 1",
							active: true,
							surfaces: [
								{ id: surfaceId("s1"), integrationId: integrationId("activity"), title: "Activity", status: "ready", selected: false },
								{ id: surfaceId("s2"), integrationId: integrationId("terminal"), title: "Shell", status: "ready", selected: false },
							],
							tile: {
								kind: "row",
								children: [
									{ tile: { kind: "leaf", surfaceId: surfaceId("s1") }, constraint: { kind: "fill", weight: 1 } },
									{ tile: { kind: "leaf", surfaceId: surfaceId("s2") }, constraint: { kind: "fill", weight: 1 } },
								],
							},
						},
					],
				},
			],
		};
		render(<LiveWorldTiles connected viewModel={viewModel} />);
		const root = screen.getByTestId("live-world-tiles");
		expect(root).toHaveAttribute("data-state", "ready");
		const tiles = screen.getAllByTestId("live-world-tile");
		expect(tiles).toHaveLength(2);
		expect(tiles[0]?.textContent).toBe("Activity");
		expect(tiles[1]?.textContent).toBe("Shell");
		// Side-by-side row split -- the second tile starts where the first ends.
		const leftWidth = Number(tiles[0]?.style.width.replace("px", ""));
		const rightLeft = Number(tiles[1]?.style.left.replace("px", ""));
		expect(rightLeft).toBe(leftWidth);
	});
});
