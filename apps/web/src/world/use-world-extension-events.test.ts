/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { integrationId, surfaceId, windowId, workspaceId } from "@zodiac/protocol";
import type { WorldViewModel } from "@zodiac/protocol";
import type { WorkspaceLifecycleEvent } from "../extensions/types.js";
import { useWorldExtensionEvents } from "./use-world-extension-events.js";

const EMPTY: WorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };

function readyWithSurface(id: string): WorldViewModel {
	return {
		state: "ready",
		activeWorkspaceId: workspaceId("ws"),
		workspaces: [{ id: workspaceId("ws"), title: "WS", activeWindowId: windowId("win"), windows: [{ id: windowId("win"), title: "Window 0", active: true, surfaces: [{ id: surfaceId(id), integrationId: integrationId("activity"), title: id, status: "idle", selected: false }] }] }],
	} as unknown as WorldViewModel;
}

describe("useWorldExtensionEvents", () => {
	it("emits nothing on the very first render -- there is no previous frame to diff against", () => {
		const emit = vi.fn<(event: WorkspaceLifecycleEvent) => void>();
		renderHook(() => useWorldExtensionEvents(EMPTY, emit));
		expect(emit).not.toHaveBeenCalled();
	});

	it("emits the diffed events once the viewModel actually changes between renders", () => {
		const emit = vi.fn<(event: WorkspaceLifecycleEvent) => void>();
		const { rerender } = renderHook<void, { viewModel: WorldViewModel }>(({ viewModel }) => useWorldExtensionEvents(viewModel, emit), { initialProps: { viewModel: EMPTY } });
		expect(emit).not.toHaveBeenCalled();

		rerender({ viewModel: readyWithSurface("s1") });

		expect(emit).toHaveBeenCalledWith({ type: "workspace:selected", workspaceId: workspaceId("ws") });
		expect(emit).toHaveBeenCalledWith({ type: "surface:docked", workspaceId: workspaceId("ws"), windowId: windowId("win"), instance: { id: surfaceId("s1"), templateId: integrationId("activity"), title: "s1" } });
	});

	it("emits nothing again when rerendered with the same viewModel reference", () => {
		const emit = vi.fn<(event: WorkspaceLifecycleEvent) => void>();
		const viewModel = readyWithSurface("s1");
		const { rerender } = renderHook<void, { viewModel: WorldViewModel }>(({ viewModel }) => useWorldExtensionEvents(viewModel, emit), { initialProps: { viewModel: EMPTY } });
		rerender({ viewModel });
		emit.mockClear();

		rerender({ viewModel });

		expect(emit).not.toHaveBeenCalled();
	});
});
