/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkspaceRegistry } from "./useWorkspaceRegistry.js";
import type { WorkspaceCatalogEntry } from "./workspace-catalog.js";

function icon() {
	return null;
}

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

	it("lazily creates a Workspace for a catalog entry that appears after mount (e.g. a user-created Workspace), instead of only using the mount-time catalog", () => {
		const { result, rerender } = renderHook((catalog: readonly WorkspaceCatalogEntry[]) => useWorkspaceRegistry(catalog), { initialProps: CATALOG });

		const grown = [...CATALOG, { id: "deploys", title: "Deploys", icon }];
		rerender(grown);

		act(() => result.current.selectWorkspace("deploys"));
		expect(result.current.workspace.id).toBe("deploys");
		expect(result.current.activeWindow.dockedSurfaces).toEqual([]);
	});

	it("selecting a brand-new catalog entry in the same render pass it first appears in (before the reactive effect has materialized it) never throws", () => {
		// Simulates App.tsx's real create-then-select flow: catalog grows and
		// selectWorkspace(newId) both happen before any effect has run.
		const { result, rerender } = renderHook((catalog: readonly WorkspaceCatalogEntry[]) => useWorkspaceRegistry(catalog), { initialProps: CATALOG });

		const grown = [...CATALOG, { id: "deploys", title: "Deploys", icon }];
		expect(() => {
			rerender(grown);
			act(() => result.current.selectWorkspace("deploys"));
		}).not.toThrow();
		expect(result.current.workspace.id).toBe("deploys");
	});

	it("still throws for a genuinely unknown id -- absent from both state and the current catalog", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
		expect(() => act(() => result.current.selectWorkspace("does-not-exist"))).toThrow(/no Workspace registered/i);
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

	it("pinChat/unpinChat toggle chatPinned, and docked Chat only follows the active Window while unpinned", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
		act(() => result.current.dockChat("Chat"));
		expect(result.current.chatPinned).toBe(false);

		act(() => result.current.addWindow()); // window 1, active; Chat still in window 0
		act(() => result.current.pinChat());
		expect(result.current.chatPinned).toBe(true);

		act(() => result.current.previousWindow()); // -> window 0
		expect(result.current.chatPinned).toBe(true);

		act(() => result.current.unpinChat());
		expect(result.current.chatPinned).toBe(false);

		act(() => result.current.nextWindow()); // -> window 1: Chat follows now that it's unpinned
		expect(result.current.activeWindow.dockedSurfaces.some((surface) => surface.templateId === "chat")).toBe(true);
	});

	describe("renameWorkspace", () => {
		it("renames the active Workspace's own title", () => {
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
			act(() => result.current.renameWorkspace("bug", "Bug Triage"));
			expect(result.current.workspace.title).toBe("Bug Triage");
		});

		it("renames a background (non-active) Workspace without switching to it", () => {
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
			act(() => result.current.renameWorkspace("metrics", "Growth Metrics"));

			// Still on "bug" -- renaming "metrics" didn't switch the active Workspace.
			expect(result.current.activeWorkspaceId).toBe("bug");

			act(() => result.current.selectWorkspace("metrics"));
			expect(result.current.workspace.title).toBe("Growth Metrics");
		});

		it("rejects a blank title, leaving the Workspace unchanged", () => {
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
			act(() => result.current.renameWorkspace("bug", "   "));
			expect(result.current.workspace.title).toBe("Bug");
		});

		it("is a no-op for an unknown id", () => {
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
			act(() => result.current.renameWorkspace("does-not-exist", "New title"));
			expect(result.current.workspace.title).toBe("Bug");
		});
	});
});
