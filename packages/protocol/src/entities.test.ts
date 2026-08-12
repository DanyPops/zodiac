import { describe, expect, it } from "vitest";
import { IntegrationDefinitionSchema, WorkspaceSchema, WorldSchema } from "./entities.js";

function validWorkspace() {
	return {
		id: "bug-triage",
		title: "Bug Triage",
		windows: [{ id: "window-0", title: "Window 0", surfaces: [] }],
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

	it("rejects a Surface with a blank integrationId nested inside a Window", () => {
		const malformed = { ...validWorkspace(), windows: [{ id: "window-0", title: "Window 0", surfaces: [{ id: "s1", integrationId: "", title: "Bad" }] }] };
		expect(WorkspaceSchema.safeParse(malformed).success).toBe(false);
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

	it("rejects a World carrying more Workspaces than the explicit bound allows", () => {
		const tooMany = Array.from({ length: 257 }, (_, index) => ({ ...validWorkspace(), id: `w${index}` }));
		expect(WorldSchema.safeParse({ id: "w1", workspaces: tooMany }).success).toBe(false);
	});
});
