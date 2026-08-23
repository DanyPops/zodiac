import { describe, expect, it } from "vitest";
import { windowId, workspaceId, type WorkspaceViewModel } from "@zodiac/protocol";
import { resolveActiveWindowId } from "./active-window-id.js";

function workspaceViewModel(windowIds: string[], activeIndex: number): WorkspaceViewModel {
	return {
		id: workspaceId("ws-1"),
		title: "Test",
		activeWindowId: windowId(windowIds[activeIndex]!),
		windows: windowIds.map((id) => ({ id: windowId(id), title: id, active: id === windowIds[activeIndex], surfaces: [], tile: null })),
		activeIntegrationIds: [],
	};
}

describe("resolveActiveWindowId", () => {
	it("returns the daemon's real active window id at the given index, not the local fallback", () => {
		const daemonWorkspace = workspaceViewModel(["window-a", "window-b"], 1);
		expect(resolveActiveWindowId(daemonWorkspace, 1, "local-mock-id")).toBe("window-b");
	});

	// The exact regression: index 0 selected must resolve to that window's own
	// real id, not silently stay pinned to whatever the local fallback holds.
	it("resolves a fresh id after the active index changes -- never sticks to the previous window's id", () => {
		const daemonWorkspace = workspaceViewModel(["window-a", "window-b"], 0);
		expect(resolveActiveWindowId(daemonWorkspace, 0, "local-mock-id")).toBe("window-a");
		expect(resolveActiveWindowId(daemonWorkspace, 1, "local-mock-id")).toBe("window-b");
	});

	it("falls back to the local id before the daemon workspace is resolved", () => {
		expect(resolveActiveWindowId(undefined, 0, "local-mock-id")).toBe("local-mock-id");
	});

	it("falls back to the local id if the index is out of bounds", () => {
		const daemonWorkspace = workspaceViewModel(["window-a"], 0);
		expect(resolveActiveWindowId(daemonWorkspace, 5, "local-mock-id")).toBe("local-mock-id");
	});
});
