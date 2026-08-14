/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExtensionHost } from "../extensions/extension-host.js";
import { useWorkspaceRegistry } from "./useWorkspaceRegistry.js";
import type { WorkspaceCatalogEntry } from "./workspace-catalog.js";

function icon() {
	return null;
}

const CATALOG: readonly WorkspaceCatalogEntry[] = [
	{ id: "bug", title: "Bug", icon: () => null },
	{ id: "metrics", title: "Metrics", icon: () => null },
];

// Every test below (except the "empty catalog" describe block) renders with
// CATALOG, a non-empty fixture that's always immediately selected on the
// first entry -- `workspace`/`activeWindow` are provably defined at every
// point these tests read them, so a `!` here is asserting a real invariant
// of the fixture, not suppressing a genuine possibility.

describe("useWorkspaceRegistry", () => {
	it("creates one Workspace per catalog entry, active on the first, one empty Window each", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
		expect(result.current.activeWorkspaceId).toBe("bug");
		expect(result.current.workspace!.id).toBe("bug");
		expect(result.current.activeWindow!.dockedSurfaces).toEqual([]);
	});

	it("selectWorkspace switches which Workspace's state the rest of the handle reads, without resetting it", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));

		act(() => result.current.dockSurface("activity", "Activity"));
		expect(result.current.activeWindow!.dockedSurfaces).toHaveLength(1);

		act(() => result.current.selectWorkspace("metrics"));
		expect(result.current.activeWorkspaceId).toBe("metrics");
		expect(result.current.workspace!.id).toBe("metrics");
		// A different Workspace: its own independent, untouched state.
		expect(result.current.activeWindow!.dockedSurfaces).toEqual([]);

		act(() => result.current.selectWorkspace("bug"));
		// Switching back: "bug"'s own earlier state survived the switch away, not reset.
		expect(result.current.activeWindow!.dockedSurfaces).toHaveLength(1);
	});

	it("nextWindow/previousWindow/addWindow drive the active Workspace's active Window forward, backward, and to a fresh one", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));

		act(() => result.current.addWindow());
		expect(result.current.workspace!.activeWindowIndex).toBe(1);

		act(() => result.current.previousWindow());
		expect(result.current.workspace!.activeWindowIndex).toBe(0);

		act(() => result.current.previousWindow());
		expect(result.current.workspace!.activeWindowIndex).toBe(1); // wraps to the last

		act(() => result.current.nextWindow());
		expect(result.current.workspace!.activeWindowIndex).toBe(0); // wraps to the first
	});

	it("selectWindow jumps directly to an index", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
		act(() => result.current.addWindow());
		act(() => result.current.addWindow());
		expect(result.current.workspace!.activeWindowIndex).toBe(2);

		act(() => result.current.selectWindow(0));
		expect(result.current.workspace!.activeWindowIndex).toBe(0);
	});

	it("dockSurface adds to the active Window and returns the created instance; undockSurface removes it", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));

		let instanceId = "";
		act(() => {
			instanceId = result.current.dockSurface("activity", "Activity")!.id;
		});
		expect(result.current.activeWindow!.dockedSurfaces.map((surface) => surface.id)).toEqual([instanceId]);

		act(() => result.current.undockSurface(instanceId));
		expect(result.current.activeWindow!.dockedSurfaces).toEqual([]);
	});

	it("scrollWindow drives the Window Carousel's own scroll policy -- creates an ephemeral Window past the single Window's end", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));

		act(() => result.current.scrollWindow(1));
		expect(result.current.workspace!.windows).toHaveLength(2);
		expect(result.current.activeWindow!.ephemeral).toBe(true);
	});

	it("renameWindow renames a Window by id", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
		const windowId = result.current.activeWindow!.id;

		act(() => result.current.renameWindow(windowId, "Debugging"));
		expect(result.current.activeWindow!.title).toBe("Debugging");
	});

	it("lazily creates a Workspace for a catalog entry that appears after mount (e.g. a user-created Workspace), instead of only using the mount-time catalog", () => {
		const { result, rerender } = renderHook((catalog: readonly WorkspaceCatalogEntry[]) => useWorkspaceRegistry(catalog), { initialProps: CATALOG });

		const grown = [...CATALOG, { id: "deploys", title: "Deploys", icon }];
		rerender(grown);

		act(() => result.current.selectWorkspace("deploys"));
		expect(result.current.workspace!.id).toBe("deploys");
		expect(result.current.activeWindow!.dockedSurfaces).toEqual([]);
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
		expect(result.current.workspace!.id).toBe("deploys");
	});

	it("still throws for a genuinely unknown id -- absent from both state and the current catalog", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
		expect(() => act(() => result.current.selectWorkspace("does-not-exist"))).toThrow(/no Workspace registered/i);
	});

	it("dockChat/isChatDocked/undockChatToGlobal drive Chat between global and docked", () => {
		const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
		expect(result.current.isChatDocked).toBe(false);

		let instanceId = "";
		act(() => {
			instanceId = result.current.dockChat("Chat")!.id;
		});
		expect(result.current.isChatDocked).toBe(true);
		expect(result.current.activeWindow!.dockedSurfaces.map((surface) => surface.id)).toEqual([instanceId]);

		act(() => result.current.undockChatToGlobal());
		expect(result.current.isChatDocked).toBe(false);
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
		expect(result.current.activeWindow!.dockedSurfaces.some((surface) => surface.templateId === "chat")).toBe(true);
	});

	describe("renameWorkspace", () => {
		it("renames the active Workspace's own title", () => {
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
			act(() => result.current.renameWorkspace("bug", "Bug Triage"));
			expect(result.current.workspace!.title).toBe("Bug Triage");
		});

		it("renames a background (non-active) Workspace without switching to it", () => {
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
			act(() => result.current.renameWorkspace("metrics", "Growth Metrics"));

			// Still on "bug" -- renaming "metrics" didn't switch the active Workspace.
			expect(result.current.activeWorkspaceId).toBe("bug");

			act(() => result.current.selectWorkspace("metrics"));
			expect(result.current.workspace!.title).toBe("Growth Metrics");
		});

		it("rejects a blank title, leaving the Workspace unchanged", () => {
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
			act(() => result.current.renameWorkspace("bug", "   "));
			expect(result.current.workspace!.title).toBe("Bug");
		});

		it("is a no-op for an unknown id", () => {
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
			act(() => result.current.renameWorkspace("does-not-exist", "New title"));
			expect(result.current.workspace!.title).toBe("Bug");
		});
	});

	describe("removeWorkspace", () => {
		it("drops the Workspace's own in-memory state -- selecting the same id again starts fresh, not with its old docked Surfaces", () => {
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
			act(() => result.current.dockSurface("activity", "Activity"));
			expect(result.current.activeWindow!.dockedSurfaces).toHaveLength(1);

			act(() => result.current.removeWorkspace("bug"));
			act(() => result.current.selectWorkspace("bug"));

			expect(result.current.activeWindow!.dockedSurfaces).toEqual([]);
		});

		it("removing the active Workspace activates the next remaining catalog entry", () => {
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
			expect(result.current.activeWorkspaceId).toBe("bug");

			act(() => result.current.removeWorkspace("bug"));

			expect(result.current.activeWorkspaceId).toBe("metrics");
			expect(result.current.workspace!.id).toBe("metrics");
		});

		it("removing a background (non-active) Workspace doesn't touch which one is active", () => {
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
			act(() => result.current.removeWorkspace("metrics"));

			expect(result.current.activeWorkspaceId).toBe("bug");
			expect(result.current.workspace!.id).toBe("bug");
		});

		it("removing the last remaining Workspace leaves the same genuinely-empty state a fresh app starts in", () => {
			const { result } = renderHook(() => useWorkspaceRegistry([CATALOG[0]!]));
			act(() => result.current.removeWorkspace("bug"));

			expect(result.current.activeWorkspaceId).toBeUndefined();
			expect(result.current.workspace).toBeUndefined();
			expect(result.current.activeWindow).toBeUndefined();
		});

		it("is a no-op for an unknown id", () => {
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG));
			act(() => result.current.removeWorkspace("does-not-exist"));

			expect(result.current.activeWorkspaceId).toBe("bug");
			expect(result.current.workspace!.id).toBe("bug");
		});

		it("emits workspace:removed for any registered extension's on() handler", () => {
			const handler = vi.fn();
			const host: ExtensionHost = { registerExtension: () => {}, emit: handler, surfaceTemplates: () => [], commands: () => [] };
			const { result } = renderHook(() => useWorkspaceRegistry(CATALOG, undefined, host));
			act(() => result.current.removeWorkspace("bug"));

			expect(handler).toHaveBeenCalledWith({ type: "workspace:removed", workspaceId: "bug" });
		});
	});

	describe("an empty catalog -- Zodiac's real 'no Workspace yet' starting state", () => {
		it("never throws, and reports no active Workspace", () => {
			const { result } = renderHook(() => useWorkspaceRegistry([]));
			expect(result.current.activeWorkspaceId).toBeUndefined();
			expect(result.current.workspace).toBeUndefined();
			expect(result.current.activeWindow).toBeUndefined();
			expect(result.current.catalog).toEqual([]);
		});

		it("every mutating action is a real no-op, not a throw, with no active Workspace", () => {
			const { result } = renderHook(() => useWorkspaceRegistry([]));
			expect(() => {
				act(() => {
					result.current.nextWindow();
					result.current.previousWindow();
					result.current.addWindow();
					result.current.undockSurface("whatever");
				});
			}).not.toThrow();
			expect(result.current.dockSurface("activity", "Activity")).toBeUndefined();
			expect(result.current.dockChat("Chat")).toBeUndefined();
			expect(result.current.isChatDocked).toBe(false);
			expect(result.current.chatPinned).toBe(false);
		});

		it("a Workspace appearing later in `catalog` (e.g. the auto-create-on-first-prompt flow) is picked up once selected, exactly like the non-empty case", () => {
			const { result, rerender } = renderHook(({ catalog }: { catalog: readonly WorkspaceCatalogEntry[] }) => useWorkspaceRegistry(catalog), {
				initialProps: { catalog: [] as readonly WorkspaceCatalogEntry[] },
			});
			expect(result.current.workspace).toBeUndefined();

			rerender({ catalog: [{ id: "fresh", title: "Fresh Workspace", icon }] });
			act(() => result.current.selectWorkspace("fresh"));

			expect(result.current.activeWorkspaceId).toBe("fresh");
			expect(result.current.workspace?.id).toBe("fresh");
		});
	});
});
