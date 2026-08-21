import { describe, expect, it } from "vitest";
import { IntegrationDefinitionSchema, SurfaceSchema, WorkspaceSchema, WorldSchema } from "./entities.js";

function validWorkspace() {
	return {
		id: "bug-triage",
		title: "Bug Triage",
		windows: [{ id: "window-0", title: "Window 0" }],
		surfaces: [],
		activeWindowIndex: 0,
	};
}

describe("WorkspaceSchema", () => {
	it("accepts a well-formed Workspace with one Window", () => {
		const result = WorkspaceSchema.safeParse(validWorkspace());
		expect(result.success).toBe(true);
	});

	it("rejects a Workspace with zero Windows -- a Workspace always has at least one", () => {
		const result = WorkspaceSchema.safeParse({ ...validWorkspace(), windows: [] });
		expect(result.success).toBe(false);
	});

	it("rejects a blank title", () => {
		const result = WorkspaceSchema.safeParse({ ...validWorkspace(), title: "" });
		expect(result.success).toBe(false);
	});

	it("rejects a negative activeWindowIndex", () => {
		const result = WorkspaceSchema.safeParse({ ...validWorkspace(), activeWindowIndex: -1 });
		expect(result.success).toBe(false);
	});

	it("rejects an extra, unrelated shape entirely (fails closed on garbage input)", () => {
		expect(WorkspaceSchema.safeParse("not-a-workspace").success).toBe(false);
		expect(WorkspaceSchema.safeParse(null).success).toBe(false);
		expect(WorkspaceSchema.safeParse(undefined).success).toBe(false);
	});

	it("requires every Surface to name its authoritative Window", () => {
		expect(SurfaceSchema.safeParse({ id: "s1", integrationId: "activity", title: "Activity" }).success).toBe(false);
		expect(SurfaceSchema.safeParse({ id: "s1", windowId: "window-0", integrationId: "activity", title: "Activity" }).success).toBe(true);
	});

	it("rejects a Surface whose authoritative windowId is not in the Workspace", () => {
		const malformed = { ...validWorkspace(), surfaces: [{ id: "s1", windowId: "missing-window", integrationId: "activity", title: "Activity" }] };
		expect(WorkspaceSchema.safeParse(malformed).success).toBe(false);
	});

	it("rejects duplicate Surface ids in the Workspace-level registry", () => {
		const duplicate = { id: "s1", windowId: "window-0", integrationId: "activity", title: "Activity" };
		expect(WorkspaceSchema.safeParse({ ...validWorkspace(), surfaces: [duplicate, duplicate] }).success).toBe(false);
	});

	it("migrates a legacy Window-owned Surface collection into the authoritative Workspace registry", () => {
		const result = WorkspaceSchema.safeParse({
			id: "bug-triage",
			title: "Bug Triage",
			windows: [{ id: "window-0", title: "Window 0", surfaces: [{ id: "s1", integrationId: "activity", title: "Activity" }] }],
			activeWindowIndex: 0,
		});
		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({
			...validWorkspace(),
			surfaces: [{ id: "s1", windowId: "window-0", integrationId: "activity", title: "Activity" }],
		});
	});
});

function validIntegrationDefinition(capabilities: { renderable: boolean; hasApi: boolean }) {
	return { id: "activity", title: "Activity", capabilities };
}

describe("IntegrationDefinitionSchema", () => {
	it("accepts a renderable-only Integration", () => {
		expect(IntegrationDefinitionSchema.safeParse(validIntegrationDefinition({ renderable: true, hasApi: false })).success).toBe(true);
	});

	it("accepts an API-only Integration", () => {
		expect(IntegrationDefinitionSchema.safeParse(validIntegrationDefinition({ renderable: false, hasApi: true })).success).toBe(true);
	});

	it("accepts an Integration that is both renderable and has an API", () => {
		expect(IntegrationDefinitionSchema.safeParse(validIntegrationDefinition({ renderable: true, hasApi: true })).success).toBe(true);
	});

	it("rejects an Integration with neither capability flag set", () => {
		expect(IntegrationDefinitionSchema.safeParse(validIntegrationDefinition({ renderable: false, hasApi: false })).success).toBe(false);
	});
});

describe("WorldSchema", () => {
	it("accepts an empty World (no Workspaces yet)", () => {
		expect(WorldSchema.safeParse({ id: "w1", workspaces: [] }).success).toBe(true);
	});

	it("accepts a World containing well-formed Workspaces", () => {
		expect(WorldSchema.safeParse({ id: "w1", workspaces: [validWorkspace()] }).success).toBe(true);
	});

	it("rejects a World whose id is blank", () => {
		expect(WorldSchema.safeParse({ id: "", workspaces: [] }).success).toBe(false);
	});

	it("rejects duplicate Window or Surface ids across Workspaces so World-level indexes remain unambiguous", () => {
		const first = {
			...validWorkspace(),
			id: "first",
			surfaces: [{ id: "shared-surface", windowId: "window-0", integrationId: "activity", title: "Activity" }],
		};
		const duplicateWindow = { ...validWorkspace(), id: "second" };
		const duplicateSurface = {
			...validWorkspace(),
			id: "second",
			windows: [{ id: "window-1", title: "Window 1" }],
			surfaces: [{ id: "shared-surface", windowId: "window-1", integrationId: "activity", title: "Activity" }],
		};
		expect(WorldSchema.safeParse({ id: "w1", workspaces: [first, duplicateWindow] }).success).toBe(false);
		expect(WorldSchema.safeParse({ id: "w1", workspaces: [first, duplicateSurface] }).success).toBe(false);
	});

	it("rejects a World carrying more Workspaces than the explicit bound allows", () => {
		const tooMany = Array.from({ length: 257 }, (_, index) => ({ ...validWorkspace(), id: `w${index}` }));
		expect(WorldSchema.safeParse({ id: "w1", workspaces: tooMany }).success).toBe(false);
	});
});
