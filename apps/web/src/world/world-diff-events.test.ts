import { describe, expect, it } from "vitest";
import { integrationId, surfaceId, windowId, workspaceId } from "@zodiac/protocol";
import type { WorldViewModel } from "@zodiac/protocol";
import { diffWorldViewModels } from "./world-diff-events.js";

const EMPTY: WorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };

function ready(workspaces: readonly unknown[], activeWorkspaceId: string): WorldViewModel {
	return { state: "ready", workspaces, activeWorkspaceId } as unknown as WorldViewModel;
}

function surface(id: string, title = id) {
	return { id: surfaceId(id), integrationId: integrationId("activity"), title, status: "idle" as const, selected: false };
}

function window(id: string, surfaces: ReturnType<typeof surface>[]) {
	return { id: windowId(id), title: "Window 0", active: true, surfaces };
}

function workspace(id: string, windows: ReturnType<typeof window>[]) {
	return { id: workspaceId(id), title: id, activeWindowId: windows[0]!.id, windows };
}

describe("diffWorldViewModels", () => {
	it("emits nothing between two identical view models", () => {
		const viewModel = ready([workspace("ws", [window("win", [surface("s1")])])], "ws");
		expect(diffWorldViewModels(viewModel, viewModel)).toEqual([]);
	});

	it("emits surface:docked when a Surface appears that wasn't there before", () => {
		const before = ready([workspace("ws", [window("win", [])])], "ws");
		const after = ready([workspace("ws", [window("win", [surface("s1", "Activity")])])], "ws");

		expect(diffWorldViewModels(before, after)).toEqual([{ type: "surface:docked", workspaceId: workspaceId("ws"), windowId: windowId("win"), instance: { id: surfaceId("s1"), templateId: integrationId("activity"), title: "Activity" } }]);
	});

	it("emits surface:undocked when a Surface that was there disappears", () => {
		const before = ready([workspace("ws", [window("win", [surface("s1")])])], "ws");
		const after = ready([workspace("ws", [window("win", [])])], "ws");

		expect(diffWorldViewModels(before, after)).toEqual([{ type: "surface:undocked", workspaceId: workspaceId("ws"), surfaceInstanceId: surfaceId("s1") }]);
	});

	it("emits workspace:removed for a Workspace no longer present", () => {
		const before = ready([workspace("ws", [window("win", [])])], "ws");
		expect(diffWorldViewModels(before, EMPTY)).toEqual([{ type: "workspace:removed", workspaceId: workspaceId("ws") }]);
	});

	it("emits workspace:selected when activeWorkspaceId changes", () => {
		const before = ready([workspace("ws1", [window("win1", [])]), workspace("ws2", [window("win2", [])])], "ws1");
		const after = ready([workspace("ws1", [window("win1", [])]), workspace("ws2", [window("win2", [])])], "ws2");

		expect(diffWorldViewModels(before, after)).toEqual([{ type: "workspace:selected", workspaceId: workspaceId("ws2") }]);
	});

	it("real-concurrency case: a single diff between two SSE frames can contain several other clients' changes at once", () => {
		const before = ready([workspace("ws", [window("win", [surface("s1")])])], "ws");
		const after = ready([workspace("ws", [window("win", [surface("s2", "New")])])], "ws");

		const events = diffWorldViewModels(before, after);
		expect(events).toHaveLength(2);
		expect(events).toContainEqual({ type: "surface:undocked", workspaceId: workspaceId("ws"), surfaceInstanceId: surfaceId("s1") });
		expect(events).toContainEqual({ type: "surface:docked", workspaceId: workspaceId("ws"), windowId: windowId("win"), instance: { id: surfaceId("s2"), templateId: integrationId("activity"), title: "New" } });
	});

	it("handles transitioning from empty to a real World and back", () => {
		const populated = ready([workspace("ws", [window("win", [surface("s1")])])], "ws");
		expect(diffWorldViewModels(EMPTY, populated)).toEqual(
			expect.arrayContaining([
				{ type: "workspace:selected", workspaceId: workspaceId("ws") },
				{ type: "surface:docked", workspaceId: workspaceId("ws"), windowId: windowId("win"), instance: { id: surfaceId("s1"), templateId: integrationId("activity"), title: "s1" } },
			]),
		);
		// A whole Workspace disappearing reports only workspace:removed -- no
		// redundant per-surface surface:undocked for the surfaces it took with it.
		expect(diffWorldViewModels(populated, EMPTY)).toEqual([{ type: "workspace:removed", workspaceId: workspaceId("ws") }]);
	});
});
