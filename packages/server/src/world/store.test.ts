import { describe, expect, it } from "vitest";
import { appletId, commandId, integrationId, panelId, surfaceId, verticalId, windowId, workspaceId, worldId, type AppletDefinition, type ContributionOutcome, type IntegrationDefinition, type Panel } from "@zodiac/protocol";
import { authorizeAgentCommand } from "../agent/authorize-command.js";
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
		expect(updated?.surfaces).toEqual([surface]);
		expect(surface.windowId).toBe(workspace.windows[0]?.id);

		store.undockSurface(workspaceId("bug-triage"), surface.id);
		expect(store.getWorkspace(workspaceId("bug-triage"))?.surfaces).toEqual([]);
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
		expect(workspace?.surfaces).toHaveLength(1);
		expect(workspace?.surfaces[0]?.title).toBe("Activity");
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
			store.onChange((change) => {
				received = change.viewModel;
			});

			store.createWorkspace(workspaceId("ws"), "WS");
			expect(received).toEqual(store.worldViewModel());
		});

		it("correlates an apply mutation with its commandId while direct mutations remain uncorrelated", () => {
			const store = createWorldStore(worldId("w1"));
			const received: Array<{ commandId?: string }> = [];
			store.onChange((change) => received.push(change));

			store.createWorkspace(workspaceId("ws"), "WS");
			store.apply({ type: "window.next", workspaceId: workspaceId("ws"), commandId: commandId("cmd-next") });

			expect(received.map((change) => change.commandId)).toEqual([undefined, "cmd-next"]);
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
			expect(store.getWorkspace(workspaceId("ws"))?.surfaces).toEqual([result.value]);
			expect(result.value.windowId).toBe(windowIdValue);
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

			expect(store.getWorkspace(workspaceId("ws"))?.surfaces).toHaveLength(1);
		});

		it("apply() throws a clear error when a surface.dock intent names a Window that doesn't exist -- preserving apply()'s own throw-on-failure contract", () => {
			const store = createWorldStore(worldId("w1"));
			store.createWorkspace(workspaceId("ws"), "WS");

			expect(() => store.apply({ type: "surface.dock", workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity", windowId: windowId("ghost-window") })).toThrow(/window-not-found/);
		});
	});

	describe("openVertical -- a bounded Integration bundle opened atomically as a new Workspace", () => {
		const ACTIVITY: IntegrationDefinition = { id: integrationId("activity"), title: "Activity", capabilities: { renderable: true, hasApi: false } };
		const TERMINAL: IntegrationDefinition = { id: integrationId("terminal"), title: "Terminal", capabilities: { renderable: true, hasApi: true } };
		const API_ONLY: IntegrationDefinition = { id: integrationId("api-only"), title: "API only", capabilities: { renderable: false, hasApi: true } };
		const definitions = new Map([ACTIVITY, TERMINAL, API_ONLY].map((definition) => [definition.id, definition]));

		it("creates one Workspace and exactly one Surface per listed Integration in one notification", () => {
			const store = createWorldStore(worldId("w1"), { getIntegration: (id) => definitions.get(id) });
			const changes: unknown[] = [];
			store.onChange((change) => changes.push(change));

			const result = store.openVertical(workspaceId("delivery"), {
				id: verticalId("delivery"),
				name: "Delivery",
				integrationIds: [ACTIVITY.id, TERMINAL.id],
			});

			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.value).toEqual(store.getWorkspace(workspaceId("delivery")));
			expect(result.value.title).toBe("Delivery");
			expect(result.value.windows).toHaveLength(1);
			const targetWindowId = result.value.windows[0]!.id;
			expect(result.value.surfaces).toEqual([
				{ id: expect.any(String), windowId: targetWindowId, integrationId: ACTIVITY.id, title: ACTIVITY.title },
				{ id: expect.any(String), windowId: targetWindowId, integrationId: TERMINAL.id, title: TERMINAL.title },
			]);
			expect(store.windowTile(workspaceId("delivery"), targetWindowId)).toEqual({
				kind: "row",
				children: result.value.surfaces.map((surface) => ({ tile: { kind: "leaf", surfaceId: surface.id }, constraint: { kind: "fill", weight: 1 } })),
			});
			expect(changes).toHaveLength(1);
		});

		it("fails closed on an unknown Integration without creating a partial Workspace", () => {
			const store = createWorldStore(worldId("w1"), { getIntegration: (id) => definitions.get(id) });
			const changes: unknown[] = [];
			store.onChange((change) => changes.push(change));

			const result = store.openVertical(workspaceId("delivery"), {
				id: verticalId("delivery"),
				name: "Delivery",
				integrationIds: [ACTIVITY.id, integrationId("missing")],
			});

			expect(result).toEqual({ ok: false, reason: "integration-not-found", integrationId: integrationId("missing") });
			expect(store.getWorkspace(workspaceId("delivery"))).toBeUndefined();
			expect(changes).toEqual([]);
		});

		it("fails closed when an Integration has no renderable Surface capability", () => {
			const store = createWorldStore(worldId("w1"), { getIntegration: (id) => definitions.get(id) });
			expect(store.openVertical(workspaceId("delivery"), { id: verticalId("delivery"), name: "Delivery", integrationIds: [API_ONLY.id] })).toEqual({
				ok: false,
				reason: "integration-not-renderable",
				integrationId: API_ONLY.id,
			});
			expect(store.getWorkspace(workspaceId("delivery"))).toBeUndefined();
		});

		it("returns a typed collision instead of overwriting an existing Workspace", () => {
			const store = createWorldStore(worldId("w1"), { getIntegration: (id) => definitions.get(id) });
			store.createWorkspace(workspaceId("delivery"), "Existing");
			const before = store.snapshot();

			expect(store.openVertical(workspaceId("delivery"), { id: verticalId("delivery"), name: "Delivery", integrationIds: [ACTIVITY.id] })).toEqual({
				ok: false,
				reason: "workspace-id-collision",
				workspaceId: workspaceId("delivery"),
			});
			expect(store.snapshot()).toEqual(before);
		});
	});

	describe("moveSurfaceToWindow -- Surface.windowId authority with identity/state preservation", () => {
		function storeWithTwoWindowsAndStatefulSurface() {
			const hydrated = hydrateWorldStore({
				id: "w1",
				workspaces: [
					{
						id: "ws",
						title: "WS",
						windows: [
							{ id: "window-a", title: "A" },
							{ id: "window-b", title: "B" },
						],
						surfaces: [
							{
								id: "surface-1",
								windowId: "window-a",
								integrationId: "terminal",
								title: "Build shell",
								resource: { id: "terminal-session-1", kind: "terminal-session", version: 7, status: "ready", provenance: { packageId: "@zodiac/terminal", capability: "shell" } },
							},
							{ id: "surface-2", windowId: "window-a", integrationId: "activity", title: "Activity" },
							{ id: "surface-3", windowId: "window-b", integrationId: "lector", title: "Files" },
						],
						activeWindowIndex: 0,
					},
				],
			});
			expect(hydrated.ok).toBe(true);
			if (!hydrated.ok) throw new Error("unreachable");
			return hydrated.value;
		}

		it("moves the existing Surface atomically, preserving identity and all non-placement state", () => {
			const store = storeWithTwoWindowsAndStatefulSurface();
			const before = store.getWorkspace(workspaceId("ws"))?.surfaces.find((surface) => surface.id === surfaceId("surface-1"));
			const changes: unknown[] = [];
			store.onChange((change) => changes.push(change));

			const result = store.moveSurfaceToWindow(workspaceId("ws"), surfaceId("surface-1"), windowId("window-b"));

			expect(result).toEqual({ ok: true, moved: true, value: { ...before, windowId: windowId("window-b") } });
			const after = store.getWorkspace(workspaceId("ws"))?.surfaces.find((surface) => surface.id === surfaceId("surface-1"));
			expect({ ...after, windowId: before?.windowId }).toEqual(before);
			expect(store.workspaceViewModel(workspaceId("ws"))?.windows.map((window) => [window.id, window.surfaces.map((surface) => surface.id)])).toEqual([
				[windowId("window-a"), [surfaceId("surface-2")]],
				[windowId("window-b"), [surfaceId("surface-1"), surfaceId("surface-3")]],
			]);
			expect(store.windowTile(workspaceId("ws"), windowId("window-a"))).toEqual({ kind: "leaf", surfaceId: surfaceId("surface-2") });
			expect(store.windowTile(workspaceId("ws"), windowId("window-b"))).toEqual({
				kind: "row",
				children: [
					{ tile: { kind: "leaf", surfaceId: surfaceId("surface-3") }, constraint: { kind: "fill", weight: 1 } },
					{ tile: { kind: "leaf", surfaceId: surfaceId("surface-1") }, constraint: { kind: "fill", weight: 1 } },
				],
			});
			expect(changes).toHaveLength(1);
		});

		it("treats a move to the current Window as an explicit successful no-op without broadcasting", () => {
			const store = storeWithTwoWindowsAndStatefulSurface();
			const before = store.snapshot();
			const changes: unknown[] = [];
			store.onChange((change) => changes.push(change));

			const result = store.moveSurfaceToWindow(workspaceId("ws"), surfaceId("surface-1"), windowId("window-a"));

			expect(result).toMatchObject({ ok: true, moved: false, value: { id: surfaceId("surface-1"), windowId: windowId("window-a") } });
			expect(store.snapshot()).toEqual(before);
			expect(changes).toEqual([]);
		});

		it("returns exhaustive typed missing-id failures without mutation or notification", () => {
			const store = storeWithTwoWindowsAndStatefulSurface();
			const before = store.snapshot();
			const changes: unknown[] = [];
			store.onChange((change) => changes.push(change));

			expect(store.moveSurfaceToWindow(workspaceId("missing"), surfaceId("surface-1"), windowId("window-b"))).toEqual({ ok: false, reason: "workspace-not-found", workspaceId: workspaceId("missing") });
			expect(store.moveSurfaceToWindow(workspaceId("ws"), surfaceId("missing"), windowId("window-b"))).toEqual({ ok: false, reason: "surface-not-found", workspaceId: workspaceId("ws"), surfaceId: surfaceId("missing") });
			expect(store.moveSurfaceToWindow(workspaceId("ws"), surfaceId("surface-1"), windowId("missing"))).toEqual({ ok: false, reason: "window-not-found", workspaceId: workspaceId("ws"), windowId: windowId("missing") });
			expect(store.snapshot()).toEqual(before);
			expect(changes).toEqual([]);
		});

		it("returns the target tile bound failure without partially removing the Surface from its source", () => {
			const targetSurfaces = Array.from({ length: 16 }, (_, index) => ({ id: `target-${index}`, windowId: "window-b", integrationId: "activity", title: `Target ${index}` }));
			const hydrated = hydrateWorldStore({
				id: "w1",
				workspaces: [
					{
						id: "ws",
						title: "WS",
						windows: [
							{ id: "window-a", title: "A" },
							{ id: "window-b", title: "B" },
						],
						surfaces: [{ id: "source", windowId: "window-a", integrationId: "terminal", title: "Source" }, ...targetSurfaces],
						activeWindowIndex: 0,
					},
				],
			});
			expect(hydrated.ok).toBe(true);
			if (!hydrated.ok) return;
			const before = hydrated.value.snapshot();

			const result = hydrated.value.moveSurfaceToWindow(workspaceId("ws"), surfaceId("source"), windowId("window-b"));

			expect(result).toEqual({ ok: false, reason: "too-many-children", limit: 16 });
			expect(hydrated.value.snapshot()).toEqual(before);
			expect(hydrated.value.windowTile(workspaceId("ws"), windowId("window-a"))).toEqual({ kind: "leaf", surfaceId: surfaceId("source") });
		});
	});

	describe("apply()'s own return value -- request/response correlation via commandId", () => {
		it("echoes the submitted commandId back, and reports surface.dock's newly created surfaceId", () => {
			const store = createWorldStore(worldId("w1"));
			store.createWorkspace(workspaceId("ws"), "WS");

			const outcome = store.apply({ type: "surface.dock", workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity", commandId: commandId("cmd-1") });

			expect(outcome.commandId).toBe(commandId("cmd-1"));
			const dockedSurfaceId = store.getWorkspace(workspaceId("ws"))?.surfaces[0]?.id;
			expect(outcome.surfaceId).toBe(dockedSurfaceId);
		});

		it("reports the created surfaceId through dockSurfaceInto's own windowId path too", () => {
			const store = createWorldStore(worldId("w1"));
			const workspace = store.createWorkspace(workspaceId("ws"), "WS");

			const outcome = store.apply({ type: "surface.dock", workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity", windowId: workspace.windows[0]!.id });

			expect(outcome.surfaceId).toBeDefined();
			expect(store.getWorkspace(workspaceId("ws"))?.surfaces[0]?.id).toBe(outcome.surfaceId);
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
			expect(store.getWorkspace(workspaceId("ws"))?.surfaces[0]?.id).toBe(surfaceId("client-2"));
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

		it("hydrateWorldStore rejects an authoritative Surface that references a Window outside its Workspace", () => {
			const result = hydrateWorldStore({
				id: "w1",
				workspaces: [
					{
						id: "ws",
						title: "WS",
						windows: [{ id: "window-a", title: "A" }],
						surfaces: [{ id: "surface-1", windowId: "window-b", integrationId: "activity", title: "Activity" }],
						activeWindowIndex: 0,
					},
				],
			});
			expect(result.ok).toBe(false);
		});

		it("hydrateWorldStore rejects competing canonical and Window-owned Surface membership", () => {
			const result = hydrateWorldStore({
				id: "w1",
				workspaces: [
					{
						id: "ws",
						title: "WS",
						windows: [{ id: "window-a", title: "A", surfaces: [] }],
						surfaces: [{ id: "surface-1", windowId: "window-a", integrationId: "activity", title: "Activity" }],
						activeWindowIndex: 0,
					},
				],
			});
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
			expect(result.value.getWorkspace(workspaceId("ws"))?.surfaces).toHaveLength(2);
		});

		it("hydrateWorldStore forwards panelOptions -- a rehydrated store gets the same seeded Panels/getApplet a fresh one would", () => {
			const footer: Panel = { id: panelId("footer"), location: "bottom", alignment: "start", offset: 0, thickness: 3, thicknessUnit: "terminal-cells", lengthMode: "fill", visibilityMode: "normal", startCap: null, endCap: null, body: [] };
			const result = hydrateWorldStore({ id: "w1", workspaces: [] }, { panels: [footer] });
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.value.panels()).toEqual([footer]);
		});
	});
});

describe("workspaceViewModel.activeIntegrationIds -- a Workspace is a context pool, independent of Window placement", () => {
	function twoWindowWorkspace() {
		const hydrated = hydrateWorldStore({
			id: "w1",
			workspaces: [{ id: "ws", title: "WS", windows: [{ id: "window-a", title: "A", surfaces: [] }, { id: "window-b", title: "B", surfaces: [] }], activeWindowIndex: 0 }],
		});
		expect(hydrated.ok).toBe(true);
		if (!hydrated.ok) throw new Error("unreachable");
		return hydrated.value;
	}

	it("reports an Integration docked into the non-active Window as active at the Workspace level", () => {
		const store = twoWindowWorkspace();
		store.dockSurfaceInto(workspaceId("ws"), integrationId("lector"), "Lector", windowId("window-b"));

		expect(store.workspaceViewModel(workspaceId("ws"))?.activeIntegrationIds).toEqual([integrationId("lector")]);
	});

	it("aggregates distinct Integrations docked across two different Windows into one Workspace-level set", () => {
		const store = twoWindowWorkspace();
		store.dockSurfaceInto(workspaceId("ws"), integrationId("lector"), "Lector", windowId("window-a"));
		store.dockSurfaceInto(workspaceId("ws"), integrationId("terminal"), "Terminal", windowId("window-b"));

		expect(store.workspaceViewModel(workspaceId("ws"))?.activeIntegrationIds).toEqual([integrationId("lector"), integrationId("terminal")]);
	});

	it("dedupes the same Integration docked into more than one Window", () => {
		const store = twoWindowWorkspace();
		store.dockSurfaceInto(workspaceId("ws"), integrationId("lector"), "Lector A", windowId("window-a"));
		store.dockSurfaceInto(workspaceId("ws"), integrationId("lector"), "Lector B", windowId("window-b"));

		expect(store.workspaceViewModel(workspaceId("ws"))?.activeIntegrationIds).toEqual([integrationId("lector")]);
	});

	it("drops an Integration once every one of its docked Surfaces in the Workspace is undocked", () => {
		const store = twoWindowWorkspace();
		const a = store.dockSurfaceInto(workspaceId("ws"), integrationId("lector"), "Lector A", windowId("window-a"));
		const b = store.dockSurfaceInto(workspaceId("ws"), integrationId("lector"), "Lector B", windowId("window-b"));
		expect(a.ok && b.ok).toBe(true);
		if (!a.ok || !b.ok) return;

		store.undockSurface(workspaceId("ws"), a.value.id);
		expect(store.workspaceViewModel(workspaceId("ws"))?.activeIntegrationIds).toEqual([integrationId("lector")]);

		store.undockSurface(workspaceId("ws"), b.value.id);
		expect(store.workspaceViewModel(workspaceId("ws"))?.activeIntegrationIds).toEqual([]);
	});
});

describe("panel.move", () => {
	const FOOTER: Panel = { id: panelId("footer"), location: "bottom", alignment: "start", offset: 0, thickness: 3, thicknessUnit: "terminal-cells", lengthMode: "fill", visibilityMode: "normal", startCap: null, endCap: null, body: [appletId("chat")] };
	const CHAT_APPLET: AppletDefinition = { id: appletId("chat"), title: "Chat", slot: "body", supportedFormFactors: new Set(["horizontal"]), maxInstances: 1 };

	it("moves a real Panel to a new Location, updating panels()", () => {
		const store = createWorldStore(worldId("w1"), { panels: [FOOTER] });
		const outcome = store.apply({ type: "panel.move", panelId: FOOTER.id, placement: { location: "top", alignment: "center", offset: 2 } });
		expect(outcome).toEqual({ commandId: undefined });
		expect(store.panels()).toEqual([{ ...FOOTER, location: "top", alignment: "center", offset: 2 }]);
	});

	it("echoes back the caller's own commandId", () => {
		const store = createWorldStore(worldId("w1"), { panels: [FOOTER] });
		const outcome = store.apply({ type: "panel.move", panelId: FOOTER.id, placement: { location: "bottom", alignment: "start", offset: 0 }, commandId: commandId("cmd-1") });
		expect(outcome).toEqual({ commandId: commandId("cmd-1") });
	});

	it("throws for an unknown panelId", () => {
		const store = createWorldStore(worldId("w1"), { panels: [FOOTER] });
		expect(() => store.apply({ type: "panel.move", panelId: panelId("nonexistent"), placement: { location: "top", alignment: "start", offset: 0 } })).toThrow();
	});

	it("throws moving to a Location whose FormFactor an assigned Applet doesn't support", () => {
		const store = createWorldStore(worldId("w1"), { panels: [FOOTER], getApplet: (id) => (id === CHAT_APPLET.id ? CHAT_APPLET : undefined) });
		// FOOTER's chat body Applet only supports horizontal; "left" is vertical.
		expect(() => store.apply({ type: "panel.move", panelId: FOOTER.id, placement: { location: "left", alignment: "start", offset: 0 } })).toThrow();
		expect(store.panels()).toEqual([FOOTER]); // rejected move never mutated state
	});

	it("allows moving to a Location an assigned Applet's own registered definition does support", () => {
		const store = createWorldStore(worldId("w1"), { panels: [FOOTER], getApplet: (id) => (id === CHAT_APPLET.id ? CHAT_APPLET : undefined) });
		expect(() => store.apply({ type: "panel.move", panelId: FOOTER.id, placement: { location: "top", alignment: "start", offset: 0 } })).not.toThrow();
	});

	it("never rejects on formFactor when getApplet can't resolve an assigned AppletId -- unconstrained, not denied", () => {
		const store = createWorldStore(worldId("w1"), { panels: [FOOTER] }); // no getApplet at all
		expect(() => store.apply({ type: "panel.move", panelId: FOOTER.id, placement: { location: "left", alignment: "start", offset: 0 } })).not.toThrow();
	});

	it("a human's direct apply() and an authorized agent tool call produce identical Panel state", () => {
		const intent = { type: "panel.move" as const, panelId: FOOTER.id, placement: { location: "top" as const, alignment: "center" as const, offset: 1 } };

		const humanStore = createWorldStore(worldId("w1"), { panels: [FOOTER] });
		humanStore.apply(intent);

		// The agent path: authorizeAgentCommand approves first, exactly as packages/pi's real tool call does, then the identical apply() call runs.
		const agentStore = createWorldStore(worldId("w1"), { panels: [FOOTER] });
		const authorization = authorizeAgentCommand(intent, { grant: { workspaceId: workspaceId("irrelevant"), allowedCommandTypes: new Set(["panel.move"]) }, sessionPolicy: { allowed: true }, getIntegration: () => undefined });
		expect(authorization).toEqual({ ok: true });
		agentStore.apply(intent);

		expect(agentStore.panels()).toEqual(humanStore.panels());
	});
});

describe("panel.resize", () => {
	const PILLAR: Panel = { id: panelId("workspace-nav"), location: "left", alignment: "start", offset: 0, thickness: 56, thicknessUnit: "px", lengthMode: "fill", visibilityMode: "normal", startCap: null, endCap: null, body: [appletId("workspace-nav")] };

	it("updates a real Panel's own thickness, leaving its thicknessUnit and everything else untouched", () => {
		const store = createWorldStore(worldId("w1"), { panels: [PILLAR] });
		const outcome = store.apply({ type: "panel.resize", panelId: PILLAR.id, thickness: 256 });
		expect(outcome).toEqual({ commandId: undefined });
		expect(store.panels()).toEqual([{ ...PILLAR, thickness: 256 }]);
	});

	it("echoes back the caller's own commandId", () => {
		const store = createWorldStore(worldId("w1"), { panels: [PILLAR] });
		const outcome = store.apply({ type: "panel.resize", panelId: PILLAR.id, thickness: 256, commandId: commandId("cmd-1") });
		expect(outcome).toEqual({ commandId: commandId("cmd-1") });
	});

	it("throws for an unknown panelId, without mutating any existing Panel", () => {
		const store = createWorldStore(worldId("w1"), { panels: [PILLAR] });
		expect(() => store.apply({ type: "panel.resize", panelId: panelId("nonexistent"), thickness: 256 })).toThrow();
		expect(store.panels()).toEqual([PILLAR]);
	});
});

describe("integration.invoke", () => {
	/** A fake/fixture Integration contributing a brand-new command purely through integration.invoke -- no change to packages/protocol's existing named variants required. */
	function fixtureSymbolSearchIntegration() {
		const calls: { action: string; input: unknown }[] = [];
		const handler = (action: string, input: unknown): ContributionOutcome<unknown> => {
			calls.push({ action, input });
			if (action !== "symbol.search") return { ok: false, code: "unknown-action", message: `Fixture Integration doesn't understand action "${action}"` };
			const { query } = input as { query?: string };
			if (!query) return { ok: false, code: "invalid-input", message: "query is required" };
			return { ok: true, value: { matches: [`${query}#1`, `${query}#2`] } };
		};
		return { handler, calls };
	}

	it("dispatches, executes, and returns a typed outcome through a registered fixture Integration's own handler", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		const fixture = fixtureSymbolSearchIntegration();
		store.registerIntegrationInvokeHandler(integrationId("lector"), fixture.handler);

		const outcome = store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input: { query: "createWorldStore" }, commandId: commandId("cmd-1") });

		expect(outcome).toEqual({ commandId: commandId("cmd-1"), invokeResult: { ok: true, value: { matches: ["createWorldStore#1", "createWorldStore#2"] } } });
		expect(fixture.calls).toEqual([{ action: "symbol.search", input: { query: "createWorldStore" } }]);
	});

	it("routes purely by integrationId -- never inspects action/input itself, so the dispatcher stays ignorant of any specific Integration's action vocabulary", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		const fixture = fixtureSymbolSearchIntegration();
		store.registerIntegrationInvokeHandler(integrationId("lector"), fixture.handler);

		// A structurally valid intent whose action the fixture Integration itself doesn't recognize -- the dispatcher still routes it through; only the target Integration is in a position to reject it.
		const outcome = store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "something.else", input: {} });
		expect(outcome.invokeResult).toEqual({ ok: false, code: "unknown-action", message: 'Fixture Integration doesn\'t understand action "something.else"' });
	});

	it("throws for an integrationId with no registered handler -- fails loud rather than silently dropping the command", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		expect(() => store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input: {} })).toThrow(/no registered integration\.invoke handler/);
	});

	it("throws for an unknown Workspace, same fail-loud contract as every other CommandIntent variant", () => {
		const store = createWorldStore(worldId("w1"));
		const fixture = fixtureSymbolSearchIntegration();
		store.registerIntegrationInvokeHandler(integrationId("lector"), fixture.handler);
		expect(() => store.apply({ type: "integration.invoke", workspaceId: workspaceId("ghost"), integrationId: integrationId("lector"), action: "symbol.search", input: {} })).toThrow();
	});

	it("registerIntegrationInvokeHandler refuses a second handler for the same integrationId already registered", () => {
		const store = createWorldStore(worldId("w1"));
		const fixture = fixtureSymbolSearchIntegration();
		store.registerIntegrationInvokeHandler(integrationId("lector"), fixture.handler);
		expect(() => store.registerIntegrationInvokeHandler(integrationId("lector"), fixture.handler)).toThrow();
	});

	it("the returned unregister function removes the handler, and re-registering afterward succeeds", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		const fixture = fixtureSymbolSearchIntegration();
		const unregister = store.registerIntegrationInvokeHandler(integrationId("lector"), fixture.handler);
		unregister();
		expect(() => store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input: {} })).toThrow(/no registered integration\.invoke handler/);

		const secondFixture = fixtureSymbolSearchIntegration();
		expect(() => store.registerIntegrationInvokeHandler(integrationId("lector"), secondFixture.handler)).not.toThrow();
	});

	it("passes intent.approvalCapability through to the handler's own third context parameter, distinct from input -- the seam packages/server/src/approval/gated-integration-invoke.ts's gate reads", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		const contexts: (import("./store.js").IntegrationInvokeContext | undefined)[] = [];
		store.registerIntegrationInvokeHandler(integrationId("lector"), (action, input, context) => {
			contexts.push(context);
			return { ok: true, value: null };
		});

		store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input: {}, approvalCapability: "cap-abc" });
		store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input: {} });

		expect(contexts).toEqual([{ presentedCapability: "cap-abc" }, { presentedCapability: undefined }]);
	});
});

describe("workspace.rename/remove/select -- the daemon-authoritative Workspace catalog lifecycle", () => {
	it("workspace.rename updates the title and echoes commandId", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "Original");
		const outcome = store.apply({ type: "workspace.rename", workspaceId: workspaceId("ws"), title: "Renamed", commandId: commandId("cmd-1") });
		expect(outcome).toEqual({ commandId: commandId("cmd-1") });
		expect(store.getWorkspace(workspaceId("ws"))?.title).toBe("Renamed");
	});

	it("workspace.rename throws for an unknown Workspace, same contract as every other Workspace-scoped intent", () => {
		const store = createWorldStore(worldId("w1"));
		expect(() => store.apply({ type: "workspace.rename", workspaceId: workspaceId("ghost"), title: "X" })).toThrow();
	});

	it("workspace.remove drops the Workspace and every Surface/Window it owned", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		store.dockSurface(workspaceId("ws"), integrationId("activity"), "Activity", surfaceId("s1"));
		store.apply({ type: "workspace.remove", workspaceId: workspaceId("ws") });
		expect(store.getWorkspace(workspaceId("ws"))).toBeUndefined();
		expect(store.worldViewModel()).toEqual({ state: "empty", workspaces: [], activeWorkspaceId: null });
	});

	it("workspace.remove throws for an unknown Workspace", () => {
		const store = createWorldStore(worldId("w1"));
		expect(() => store.apply({ type: "workspace.remove", workspaceId: workspaceId("ghost") })).toThrow();
	});

	it("removing the active Workspace falls back to another remaining one, not a dangling id", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("first"), "First");
		store.createWorkspace(workspaceId("second"), "Second");
		expect(store.worldViewModel().activeWorkspaceId).toBe(workspaceId("first"));
		store.apply({ type: "workspace.remove", workspaceId: workspaceId("first") });
		expect(store.worldViewModel().activeWorkspaceId).toBe(workspaceId("second"));
	});

	it("workspace.select changes worldViewModel's own activeWorkspaceId", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("first"), "First");
		store.createWorkspace(workspaceId("second"), "Second");
		expect(store.worldViewModel().activeWorkspaceId).toBe(workspaceId("first"));
		const outcome = store.apply({ type: "workspace.select", workspaceId: workspaceId("second"), commandId: commandId("cmd-2") });
		expect(outcome).toEqual({ commandId: commandId("cmd-2") });
		expect(store.worldViewModel().activeWorkspaceId).toBe(workspaceId("second"));
	});

	it("workspace.select throws for an unknown Workspace", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		expect(() => store.apply({ type: "workspace.select", workspaceId: workspaceId("ghost") })).toThrow();
	});
});

describe("window.select/add/scroll/rename -- the daemon-authoritative Window carousel", () => {
	it("window.select jumps directly to a Window by id", () => {
		const store = createWorldStore(worldId("w1"));
		const workspace = store.createWorkspace(workspaceId("ws"), "WS");
		store.apply({ type: "window.add", workspaceId: workspaceId("ws") });
		const firstWindowId = workspace.windows[0]!.id;
		store.apply({ type: "window.select", workspaceId: workspaceId("ws"), windowId: firstWindowId, commandId: commandId("cmd-3") });
		expect(store.workspaceViewModel(workspaceId("ws"))?.activeWindowId).toBe(firstWindowId);
	});

	it("window.select throws for an unknown Window", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		expect(() => store.apply({ type: "window.select", workspaceId: workspaceId("ws"), windowId: windowId("ghost-window") })).toThrow();
	});

	it("window.add appends a new empty Window and makes it active", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		const outcome = store.apply({ type: "window.add", workspaceId: workspaceId("ws") });
		expect(outcome).toEqual({});
		const viewModel = store.workspaceViewModel(workspaceId("ws"));
		expect(viewModel?.windows).toHaveLength(2);
		expect(viewModel?.activeWindowId).toBe(viewModel?.windows[1]?.id);
	});

	it("window.add throws for an unknown Workspace", () => {
		const store = createWorldStore(worldId("w1"));
		expect(() => store.apply({ type: "window.add", workspaceId: workspaceId("ghost") })).toThrow();
	});

	it("window.scroll is a plain wrap-around move, the same ring as window.next/previous -- not the ephemeral-Window creation model.ts's own scrollWindow performs (deliberately deferred, see the CommandIntent's own doc comment)", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		store.apply({ type: "window.add", workspaceId: workspaceId("ws") });
		const before = store.workspaceViewModel(workspaceId("ws"))!;
		store.apply({ type: "window.scroll", workspaceId: workspaceId("ws"), direction: 1, commandId: commandId("cmd-4") });
		const after = store.workspaceViewModel(workspaceId("ws"))!;
		expect(after.activeWindowId).not.toBe(before.activeWindowId);
		expect(after.windows).toHaveLength(2); // no ephemeral Window created
	});

	it("window.scroll throws for an unknown Workspace", () => {
		const store = createWorldStore(worldId("w1"));
		expect(() => store.apply({ type: "window.scroll", workspaceId: workspaceId("ghost"), direction: 1 })).toThrow();
	});

	it("window.rename retitles a specific Window by id, not necessarily the active one", () => {
		const store = createWorldStore(worldId("w1"));
		const workspace = store.createWorkspace(workspaceId("ws"), "WS");
		store.apply({ type: "window.add", workspaceId: workspaceId("ws") });
		const firstWindowId = workspace.windows[0]!.id;
		store.apply({ type: "window.rename", workspaceId: workspaceId("ws"), windowId: firstWindowId, title: "Renamed Window", commandId: commandId("cmd-5") });
		const viewModel = store.workspaceViewModel(workspaceId("ws"));
		expect(viewModel?.windows.find((window) => window.id === firstWindowId)?.title).toBe("Renamed Window");
	});

	it("window.rename throws for an unknown Window", () => {
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		expect(() => store.apply({ type: "window.rename", workspaceId: workspaceId("ws"), windowId: windowId("ghost-window"), title: "X" })).toThrow();
	});
});
