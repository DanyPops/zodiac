import { describe, expect, it } from "vitest";
import { commandId, surfaceId, windowId, workspaceId } from "./ids.js";
import { WorldChangeSchema, WorldViewModelSchema, type ReadyWorldViewModel } from "./regions.js";

function readyWorld(): ReadyWorldViewModel {
	const window = { id: windowId("w1"), title: "Window 1", active: true, tile: null, surfaces: [] };
	return {
		state: "ready",
		activeWorkspaceId: workspaceId("ws1"),
		workspaces: [{ id: workspaceId("ws1"), title: "My Workspace", activeWindowId: window.id, windows: [window], activeIntegrationIds: [] }],
	};
}

describe("WorldViewModelSchema", () => {
	it("accepts a real empty WorldViewModel", () => {
		expect(WorldViewModelSchema.safeParse({ state: "empty", workspaces: [], activeWorkspaceId: null }).success).toBe(true);
	});

	it("accepts a real ready WorldViewModel with two Workspaces -- not capped at one", () => {
		const world = readyWorld();
		const second = { ...world.workspaces[0]!, id: workspaceId("ws2"), title: "Second Workspace" };
		const parsed = WorldViewModelSchema.safeParse({ ...world, workspaces: [world.workspaces[0]!, second] });
		expect(parsed.success).toBe(true);
	});

	it("rejects an empty-state payload that smuggles in a real Workspace", () => {
		const world = readyWorld();
		const parsed = WorldViewModelSchema.safeParse({ state: "empty", workspaces: world.workspaces, activeWorkspaceId: null });
		expect(parsed.success).toBe(false);
	});

	it("rejects a ready-state payload missing activeWorkspaceId", () => {
		const world = readyWorld();
		const parsed = WorldViewModelSchema.safeParse({ state: "ready", workspaces: world.workspaces });
		expect(parsed.success).toBe(false);
	});

	it("rejects a Surface title exceeding the bounded length", () => {
		const world = readyWorld();
		const oversized = { ...world, workspaces: [{ ...world.workspaces[0]!, windows: [{ ...world.workspaces[0]!.windows[0]!, surfaces: [{ id: surfaceId("s1"), integrationId: "terminal", title: "x".repeat(501), status: "idle", selected: false }] }] }] };
		expect(WorldViewModelSchema.safeParse(oversized).success).toBe(false);
	});

	it("rejects a completely malformed payload instead of throwing", () => {
		expect(WorldViewModelSchema.safeParse("not-an-object").success).toBe(false);
		expect(WorldViewModelSchema.safeParse(null).success).toBe(false);
		expect(WorldViewModelSchema.safeParse(undefined).success).toBe(false);
	});
});

describe("WorldChangeSchema", () => {
	it("accepts a change with a commandId", () => {
		const parsed = WorldChangeSchema.safeParse({ viewModel: readyWorld(), commandId: commandId("cmd-1") });
		expect(parsed.success).toBe(true);
	});

	it("accepts a change with no commandId -- a state resync, not command-triggered", () => {
		const parsed = WorldChangeSchema.safeParse({ viewModel: { state: "empty", workspaces: [], activeWorkspaceId: null } });
		expect(parsed.success).toBe(true);
	});

	it("rejects a change whose own viewModel is malformed", () => {
		const parsed = WorldChangeSchema.safeParse({ viewModel: { state: "ready" } });
		expect(parsed.success).toBe(false);
	});
});
