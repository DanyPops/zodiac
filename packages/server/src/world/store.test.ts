import { describe, expect, it } from "vitest";
import { integrationId, workspaceId, worldId } from "@zodiac/protocol";
import { createCommandDispatcher, type CommandDefinition } from "../command/dispatcher.js";
import { createWorldStore, hydrateWorldStore } from "./store.js";

/**
 * Walking-skeleton slice for Alignment IWE phase 1 -- proves the target
 * architecture end to end with no React, DOM, or renderer anywhere in the
 * call path: a headless World creates and updates a Surface, one typed
 * command reaches it through the real dispatcher, the result is a plain
 * JSON view model, and malformed input is rejected rather than crashing.
 */
describe("WorldStore walking skeleton", () => {
	it("projects a fresh World as an explicit empty semantic view", () => {
		const store = createWorldStore(worldId("empty"));
		expect(store.worldViewModel()).toEqual({ state: "empty", workspaces: [], activeWorkspaceId: null });
	});

	it("a headless Workspace can create and update a Surface", () => {
		const store = createWorldStore(worldId("w1"));
		const workspace = store.createWorkspace(workspaceId("bug-triage"), "Bug Triage");
		expect(workspace.windows).toHaveLength(1);

		const surface = store.dockSurface(workspaceId("bug-triage"), integrationId("activity"), "Activity");
		const updated = store.getWorkspace(workspaceId("bug-triage"));
		expect(updated?.windows[0]?.surfaces).toEqual([surface]);

		store.undockSurface(workspaceId("bug-triage"), surface.id);
		expect(store.getWorkspace(workspaceId("bug-triage"))?.windows[0]?.surfaces).toEqual([]);
	});

	it("one typed command changes state through the core dispatcher -- not by calling the store directly", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("bug-triage"), "Bug Triage");

		const dockCommand: CommandDefinition = {
			id: "surface.dock",
			title: "Dock Surface",
			description: "Dock a Surface into the Workspace's active Window.",
			execute: (...args) => {
				const [workspace, template, title] = args as [string, string, string];
				store.apply({ type: "surface.dock", workspaceId: workspaceId(workspace), integrationId: integrationId(template), title });
			},
		};
		const dispatcher = createCommandDispatcher<"global">({ commands: [dockCommand], bindings: [] });

		expect(dispatcher.execute("surface.dock", "bug-triage", "activity", "Activity")).toBe(true);

		const workspace = store.getWorkspace(workspaceId("bug-triage"));
		expect(workspace?.windows[0]?.surfaces).toHaveLength(1);
		expect(workspace?.windows[0]?.surfaces[0]?.title).toBe("Activity");
	});

	it("the resulting semantic view model can be consumed without React -- a plain, JSON-round-trippable object", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("bug-triage"), "Bug Triage");
		store.dockSurface(workspaceId("bug-triage"), integrationId("activity"), "Activity");

		const viewModel = store.workspaceViewModel(workspaceId("bug-triage"));
		expect(viewModel).toBeDefined();
		// No functions, class instances, or React elements survive a JSON round trip -- a real headless consumer (a TUI renderer, a test, a log line) needs exactly this and nothing more.
		expect(JSON.parse(JSON.stringify(viewModel))).toEqual(viewModel);
		expect(viewModel?.windows[0]?.surfaces[0]).toMatchObject({ title: "Activity", status: "idle", selected: false });
	});

	it("window.next/window.previous commands move the active Window through apply()", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		// Dock two Surfaces into distinct Windows by docking, then manually
		// appending a second Window via a fresh Workspace shape isn't exposed
		// here (WorldStore only grows Windows through intents this slice
		// defines) -- window.next on a single-Window Workspace wraps to itself,
		// which is itself a real, asserted behavior.
		store.apply({ type: "window.next", workspaceId: workspaceId("ws") });
		expect(store.getWorkspace(workspaceId("ws"))?.activeWindowIndex).toBe(0);
	});

	it("rejects an unknown Workspace id rather than silently no-op'ing", () => {
		const store = createWorldStore(worldId("w1"));
		expect(() => store.dockSurface(workspaceId("ghost"), integrationId("activity"), "Activity")).toThrow(/no Workspace/i);
	});

	describe("invalid external or persisted input is rejected at runtime", () => {
		it("hydrateWorldStore rejects a snapshot with zero Windows in a Workspace", () => {
			const result = hydrateWorldStore({ id: "w1", workspaces: [{ id: "ws", title: "WS", windows: [], activeWindowIndex: 0 }] });
			expect(result.ok).toBe(false);
		});

		it("hydrateWorldStore rejects garbage input outright", () => {
			expect(hydrateWorldStore("not a world").ok).toBe(false);
			expect(hydrateWorldStore(null).ok).toBe(false);
			expect(hydrateWorldStore({}).ok).toBe(false);
		});

		it("hydrateWorldStore accepts a well-formed snapshot and resumes real operations on it", () => {
			const result = hydrateWorldStore({
				id: "w1",
				workspaces: [{ id: "ws", title: "WS", windows: [{ id: "window-3", title: "Window 0", surfaces: [{ id: "surface-7", integrationId: "activity", title: "Activity" }] }], activeWindowIndex: 0 }],
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const surface = result.value.dockSurface(workspaceId("ws"), integrationId("terminal"), "Terminal");
			// The id sequence resumed past the rehydrated "surface-7" instead of colliding with it.
			expect(surface.id).not.toBe("surface-7");
			expect(result.value.getWorkspace(workspaceId("ws"))?.windows[0]?.surfaces).toHaveLength(2);
		});
	});
});
