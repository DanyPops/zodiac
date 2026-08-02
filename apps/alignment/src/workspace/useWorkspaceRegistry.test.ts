/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkspaceRegistry } from "./useWorkspaceRegistry.js";
import type { WorkspaceCatalogEntry } from "./workspace-catalog.js";

const CATALOG: readonly WorkspaceCatalogEntry[] = [
	{ id: "bug", title: "Bug", icon: () => null },
	{ id: "metrics", title: "Metrics", icon: () => null },
];

describe("useWorkspaceRegistry", () => {
	it("creates one Workspace per catalog entry, active on the first, one empty Window each, Chat hidden", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
		expect(result.current.activeWorkspaceId).toBe("bug");
		expect(result.current.workspace.id).toBe("bug");
		expect(result.current.activeWindow.dockedSurfaces).toEqual([]);
		expect(result.current.workspace.chatVisible).toBe(false);
	});

	it("selectWorkspace switches which Workspace's state the rest of the handle reads, without resetting it", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));

		act(() => {
			result.current.dockSurface("activity", "Activity");
			result.current.showChat();
		});
		expect(result.current.activeWindow.dockedSurfaces).toHaveLength(1);
		expect(result.current.workspace.chatVisible).toBe(true);

		act(() => result.current.selectWorkspace("metrics"));
		expect(result.current.activeWorkspaceId).toBe("metrics");
		expect(result.current.workspace.id).toBe("metrics");
		// A different Workspace: its own independent, untouched state.
		expect(result.current.activeWindow.dockedSurfaces).toEqual([]);
		expect(result.current.workspace.chatVisible).toBe(false);

		act(() => result.current.selectWorkspace("bug"));
		// Switching back: "bug"'s own earlier state survived the switch away, not reset.
		expect(result.current.activeWindow.dockedSurfaces).toHaveLength(1);
		expect(result.current.workspace.chatVisible).toBe(true);
	});

	it("nextWindow/previousWindow/addWindow drive the active Workspace's active Window forward, backward, and to a fresh one", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));

		act(() => result.current.addWindow());
		expect(result.current.workspace.activeWindowIndex).toBe(1);

		act(() => result.current.previousWindow());
		expect(result.current.workspace.activeWindowIndex).toBe(0);

		act(() => result.current.previousWindow());
		expect(result.current.workspace.activeWindowIndex).toBe(1); // wraps to the last

		act(() => result.current.nextWindow());
		expect(result.current.workspace.activeWindowIndex).toBe(0); // wraps to the first
	});

	it("selectWindow jumps directly to an index", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
		act(() => result.current.addWindow());
		act(() => result.current.addWindow());
		expect(result.current.workspace.activeWindowIndex).toBe(2);

		act(() => result.current.selectWindow(0));
		expect(result.current.workspace.activeWindowIndex).toBe(0);
	});

	it("dockSurface adds to the active Window and returns the created instance; undockSurface removes it", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));

		let instanceId = "";
		act(() => {
			instanceId = result.current.dockSurface("activity", "Activity").id;
		});
		expect(result.current.activeWindow.dockedSurfaces.map((surface) => surface.id)).toEqual([instanceId]);

		act(() => result.current.undockSurface(instanceId));
		expect(result.current.activeWindow.dockedSurfaces).toEqual([]);
	});

	it("showChat/hideChat/toggleChat drive Chat Surface visibility", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));

		act(() => result.current.showChat());
		expect(result.current.workspace.chatVisible).toBe(true);

		act(() => result.current.hideChat());
		expect(result.current.workspace.chatVisible).toBe(false);

		act(() => result.current.toggleChat());
		expect(result.current.workspace.chatVisible).toBe(true);
	});

	it("scrollWindow drives the Window Carousel's own scroll policy -- creates an ephemeral Window past the single Window's end", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));

		act(() => result.current.scrollWindow(1));
		expect(result.current.workspace.windows).toHaveLength(2);
		expect(result.current.activeWindow.ephemeral).toBe(true);
	});

	it("renameWindow renames a Window by id", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
		const windowId = result.current.activeWindow.id;

		act(() => result.current.renameWindow(windowId, "Debugging"));
		expect(result.current.activeWindow.title).toBe("Debugging");
	});

	it("dockChat/isChatDocked/undockChatToFloating drive Chat between floating and docked", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
		expect(result.current.isChatDocked).toBe(false);

		let instanceId = "";
		act(() => {
			instanceId = result.current.dockChat("Chat").id;
		});
		expect(result.current.isChatDocked).toBe(true);
		expect(result.current.workspace.chatVisible).toBe(false);
		expect(result.current.activeWindow.dockedSurfaces.map((surface) => surface.id)).toEqual([instanceId]);

		act(() => result.current.undockChatToFloating());
		expect(result.current.isChatDocked).toBe(false);
		expect(result.current.workspace.chatVisible).toBe(true);
	});
});
