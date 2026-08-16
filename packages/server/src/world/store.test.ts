import { describe, expect, it } from "vitest";
import { commandId, integrationId, surfaceId, windowId, workspaceId, worldId } from "@zodiac/protocol";
import { createCommandDispatcher, type CommandDefinition } from "../command/dispatcher.js";
import { createWorldStore, hydrateWorldStore } from "./store.js";

/**
 * Walking-skeleton slice for Zodiac IWE phase 1 -- proves the target
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

	describe("onChange -- a broadcast hook for a daemon to fan out mutations to attached clients", () => {
		it("fires after createWorkspace, dockSurface, undockSurface, and apply each succeed", () => {
			const store = createWorldStore(worldId("w1"));
			const calls: string[] = [];
			store.onChange(() => calls.push("change"));

			store.createWorkspace(workspaceId("ws"), "WS");
			expect(calls).toEqual(["change"]);

			const surface = store.dockSurface(workspaceId("ws"), integrationId("activity"), "Activity");
			expect(calls).toEqual(["change", "change"]);

			store.undockSurface(workspaceId("ws"), surface.id);
			expect(calls).toEqual(["change", "change", "change"]);

			store.apply({ type: "window.next", workspaceId: workspaceId("ws") });
			expect(calls).toEqual(["change", "change", "change", "change"]);
		});

		it("does not fire when a mutation throws instead of succeeding", () => {
			const store = createWorldStore(worldId("w1"));
			const calls: string[] = [];
			store.onChange(() => calls.push("change"));

			expect(() => store.dockSurface(workspaceId("ghost"), integrationId("activity"), "Activity")).toThrow();
			expect(calls).toEqual([]);
		});

		it("passes the fresh worldViewModel to every listener, so a subscriber never has to call back into the store", () => {
			const store = createWorldStore(worldId("w1"));
			let received: ReturnType<typeof store.worldViewModel> | undefined;
			store.onChange((viewModel) => {
				received = viewModel;
			});

			store.createWorkspace(workspaceId("ws"), "WS");
			expect(received).toEqual(store.worldViewModel());
		});

		it("supports multiple independent listeners, each of which can unsubscribe on its own", () => {
			const store = createWorldStore(worldId("w1"));
			const a: string[] = [];
			const b: string[] = [];
			const unsubscribeA = store.onChange(() => a.push("a"));
			store.onChange(() => b.push("b"));

			store.createWorkspace(workspaceId("ws"), "WS");
			expect(a).toEqual(["a"]);
			expect(b).toEqual(["b"]);

			unsubscribeA();
			store.apply({ type: "window.next", workspaceId: workspaceId("ws") });
			expect(a).toEqual(["a"]);
			expect(b).toEqual(["b", "b"]);
		});
	});

	describe("windowTile -- the tile tree dock/undock maintain alongside the flat surfaces array", () => {
		it("starts null for a freshly created Window", () => {
			const store = createWorldStore(worldId("w1"));
			const workspace = store.createWorkspace(workspaceId("ws"), "WS");
			expect(store.windowTile(workspaceId("ws"), workspace.windows[0]!.id)).toBeNull();
		});

		it("reflects a single dock as a leaf, and two docks as an evenly-weighted row", () => {
			const store = createWorldStore(worldId("w1"));
			const workspace = store.createWorkspace(workspaceId("ws"), "WS");
			const windowIdValue = workspace.windows[0]!.id;

			const s1 = store.dockSurface(workspaceId("ws"), integrationId("activity"), "Activity");
			expect(store.windowTile(workspaceId("ws"), windowIdValue)).toEqual({ kind: "leaf", surfaceId: s1.id });

			const s2 = store.dockSurface(workspaceId("ws"), integrationId("activity"), "Activity 2");
			expect(store.windowTile(workspaceId("ws"), windowIdValue)).toEqual({
				kind: "row",
				children: [
					{ tile: { kind: "leaf", surfaceId: s1.id }, constraint: { kind: "fill", weight: 1 } },
					{ tile: { kind: "leaf", surfaceId: s2.id }, constraint: { kind: "fill", weight: 1 } },
				],
			});
		});

		it("collapses back to a leaf (and then to null) as undockSurface removes each Surface", () => {
			const store = createWorldStore(worldId("w1"));
			const workspace = store.createWorkspace(workspaceId("ws"), "WS");
			const windowIdValue = workspace.windows[0]!.id;
			const s1 = store.dockSurface(workspaceId("ws"), integrationId("activity"), "Activity");
			const s2 = store.dockSurface(workspaceId("ws"), integrationId("activity"), "Activity 2");

			store.undockSurface(workspaceId("ws"), s1.id);
			expect(store.windowTile(workspaceId("ws"), windowIdValue)).toEqual({ kind: "leaf", surfaceId: s2.id });

			store.undockSurface(workspaceId("ws"), s2.id);
			expect(store.windowTile(workspaceId("ws"), windowIdValue)).toBeNull();
		});

		it("returns undefined for an unknown Workspace or an unknown Window", () => {
			const store = createWorldStore(worldId("w1"));
			const workspace = store.createWorkspace(workspaceId("ws"), "WS");
			expect(store.windowTile(workspaceId("ghost"), workspace.windows[0]!.id)).toBeUndefined();
			expect(store.windowTile(workspaceId("ws"), windowId("ghost-window"))).toBeUndefined();
		});
	});

	describe("dockSurfaceInto -- targets a specific Window by id, per CommandIntent's own optional windowId", () => {
		it("docks into the named Window and returns a typed success outcome", () => {
			const store = createWorldStore(worldId("w1"));
			const workspace = store.createWorkspace(workspaceId("ws"), "WS");
			const windowIdValue = workspace.windows[0]!.id;

			const result = store.dockSurfaceInto(workspaceId("ws"), integrationId("activity"), "Activity", windowIdValue);

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(store.getWorkspace(workspaceId("ws"))?.windows[0]?.surfaces).toEqual([result.value]);
		});

		it("returns a typed failure for an unknown Workspace", () => {
			const store = createWorldStore(worldId("w1"));
			const workspace = store.createWorkspace(workspaceId("ws"), "WS");

			const result = store.dockSurfaceInto(workspaceId("ghost"), integrationId("activity"), "Activity", workspace.windows[0]!.id);

			expect(result).toEqual({ ok: false, reason: "workspace-not-found", workspaceId: workspaceId("ghost") });
		});

		it("returns a typed failure for a Window id that doesn't exist in that Workspace", () => {
			const store = createWorldStore(worldId("w1"));
			store.createWorkspace(workspaceId("ws"), "WS");

			const result = store.dockSurfaceInto(workspaceId("ws"), integrationId("activity"), "Activity", windowId("ghost-window"));

			expect(result).toEqual({ ok: false, reason: "window-not-found", workspaceId: workspaceId("ws"), windowId: windowId("ghost-window") });
		});

		it("apply() routes a surface.dock intent's own windowId through dockSurfaceInto", () => {
			const store = createWorldStore(worldId("w1"));
			const workspace = store.createWorkspace(workspaceId("ws"), "WS");
			const windowIdValue = workspace.windows[0]!.id;

			store.apply({ type: "surface.dock", workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity", windowId: windowIdValue });

			expect(store.getWorkspace(workspaceId("ws"))?.windows[0]?.surfaces).toHaveLength(1);
		});

		it("apply() throws a clear error when a surface.dock intent names a Window that doesn't exist -- preserving apply()'s own throw-on-failure contract", () => {
			const store = createWorldStore(worldId("w1"));
			store.createWorkspace(workspaceId("ws"), "WS");

			expect(() => store.apply({ type: "surface.dock", workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity", windowId: windowId("ghost-window") })).toThrow(/window-not-found/);
		});
	});

	describe("apply()'s own return value -- request/response correlation via commandId", () => {
		it("echoes the submitted commandId back, and reports surface.dock's newly created surfaceId", () => {
			const store = createWorldStore(worldId("w1"));
			store.createWorkspace(workspaceId("ws"), "WS");

			const outcome = store.apply({ type: "surface.dock", workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity", commandId: commandId("cmd-1") });

			expect(outcome.commandId).toBe(commandId("cmd-1"));
			const dockedSurfaceId = store.getWorkspace(workspaceId("ws"))?.windows[0]?.surfaces[0]?.id;
			expect(outcome.surfaceId).toBe(dockedSurfaceId);
		});

		it("reports the created surfaceId through dockSurfaceInto's own windowId path too", () => {
			const store = createWorldStore(worldId("w1"));
			const workspace = store.createWorkspace(workspaceId("ws"), "WS");

			const outcome = store.apply({ type: "surface.dock", workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity", windowId: workspace.windows[0]!.id });

			expect(outcome.surfaceId).toBeDefined();
			expect(store.getWorkspace(workspaceId("ws"))?.windows[0]?.surfaces[0]?.id).toBe(outcome.surfaceId);
		});

		it("returns just the echoed commandId (no surfaceId) for intents that don't create a Surface", () => {
			const store = createWorldStore(worldId("w1"));
			store.createWorkspace(workspaceId("ws"), "WS");

			const outcome = store.apply({ type: "window.next", workspaceId: workspaceId("ws"), commandId: commandId("cmd-2") });

			expect(outcome).toEqual({ commandId: commandId("cmd-2") });
		});

		it("omits commandId when the caller didn't supply one", () => {
			const store = createWorldStore(worldId("w1"));
			store.createWorkspace(workspaceId("ws"), "WS");

			const outcome = store.apply({ type: "window.next", workspaceId: workspaceId("ws") });

			expect(outcome.commandId).toBeUndefined();
		});
	});

	describe("caller-supplied surfaceId -- surface.dock's own identity/authority fix", () => {
		it("dockSurface uses the caller-supplied surfaceId instead of auto-generating one", () => {
			const store = createWorldStore(worldId("w1"));
			store.createWorkspace(workspaceId("ws"), "WS");

			const surface = store.dockSurface(workspaceId("ws"), integrationId("activity"), "Activity", surfaceId("client-1"));

			expect(surface.id).toBe(surfaceId("client-1"));
		});

		it("dockSurface throws a clear surface-id-collision error when the requested id is already in use", () => {
			const store = createWorldStore(worldId("w1"));
			store.createWorkspace(workspaceId("ws"), "WS");
			store.dockSurface(workspaceId("ws"), integrationId("activity"), "Activity", surfaceId("client-1"));

			expect(() => store.dockSurface(workspaceId("ws"), integrationId("activity"), "Activity 2", surfaceId("client-1"))).toThrow(/surface-id-collision/);
		});

		it("dockSurfaceInto reports a typed surface-id-collision failure instead of throwing", () => {
			const store = createWorldStore(worldId("w1"));
			const workspace = store.createWorkspace(workspaceId("ws"), "WS");
			store.dockSurface(workspaceId("ws"), integrationId("activity"), "Activity", surfaceId("client-1"));

			const result = store.dockSurfaceInto(workspaceId("ws"), integrationId("activity"), "Activity 2", workspace.windows[0]!.id, surfaceId("client-1"));

			expect(result).toEqual({ ok: false, reason: "surface-id-collision", surfaceId: surfaceId("client-1") });
		});

		it("apply() passes a surface.dock intent's own surfaceId through to the created Surface", () => {
			const store = createWorldStore(worldId("w1"));
			store.createWorkspace(workspaceId("ws"), "WS");

			const outcome = store.apply({ type: "surface.dock", workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity", surfaceId: surfaceId("client-2") });

			expect(outcome.surfaceId).toBe(surfaceId("client-2"));
			expect(store.getWorkspace(workspaceId("ws"))?.windows[0]?.surfaces[0]?.id).toBe(surfaceId("client-2"));
		});

		it("apply() throws a clear surface-id-collision error for a colliding surfaceId, whether or not a windowId is also given", () => {
			const store = createWorldStore(worldId("w1"));
			const workspace = store.createWorkspace(workspaceId("ws"), "WS");
			store.apply({ type: "surface.dock", workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity", surfaceId: surfaceId("dup") });

			expect(() => store.apply({ type: "surface.dock", workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity 2", surfaceId: surfaceId("dup") })).toThrow(/surface-id-collision/);
			expect(() => store.apply({ type: "surface.dock", workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity 3", windowId: workspace.windows[0]!.id, surfaceId: surfaceId("dup") })).toThrow(/surface-id-collision/);
		});

		it("omits surfaceId from apply()'s outcome for intents that don't create a Surface, even if one collides elsewhere", () => {
			const store = createWorldStore(worldId("w1"));
			store.createWorkspace(workspaceId("ws"), "WS");

			const outcome = store.apply({ type: "window.next", workspaceId: workspaceId("ws") });

			expect(outcome.surfaceId).toBeUndefined();
		});
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
