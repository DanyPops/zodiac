import { integrationId, surfaceId, windowId, workspaceId, type IntegrationDefinition, type Workspace } from "@zodiac/protocol";
import { describe, expect, it } from "vitest";
import { deriveWorkspaceToolIds, diffToolIds, type ToolContribution } from "./tool-grant.js";

const WS = workspaceId("ws-1");
const WIN = windowId("window-1");
const LECTOR = integrationId("lector");
const TERMINAL = integrationId("terminal");

function workspaceWithSurfaces(integrationIds: readonly (readonly [string, ReturnType<typeof integrationId>])[]): Workspace {
	return {
		id: WS,
		title: "Test",
		activeWindowIndex: 0,
		windows: [{ id: WIN, title: "Window 0" }],
		surfaces: integrationIds.map(([id, integration]) => ({ id: surfaceId(id), windowId: WIN, integrationId: integration, title: id })),
	};
}

function integrations(...defs: readonly IntegrationDefinition[]): (id: ReturnType<typeof integrationId>) => IntegrationDefinition | undefined {
	return (id) => defs.find((definition) => definition.id === id);
}

function contributions(...defs: readonly ToolContribution[]): (id: ReturnType<typeof integrationId>) => ToolContribution | undefined {
	return (id) => defs.find((definition) => definition.integrationId === id);
}

describe("deriveWorkspaceToolIds", () => {
	it("returns empty for no docked Surfaces", () => {
		expect(deriveWorkspaceToolIds(workspaceWithSurfaces([]), () => undefined, () => undefined)).toEqual(new Set());
	});

	it("grants a contribution when the Integration has hasApi:true", () => {
		const workspace = workspaceWithSurfaces([["s1", LECTOR]]);
		const getIntegration = integrations({ id: LECTOR, title: "Lector", capabilities: { renderable: true, hasApi: true } });
		const getContribution = contributions({ integrationId: LECTOR, toolId: "lector.fs" });
		expect(deriveWorkspaceToolIds(workspace, getIntegration, getContribution)).toEqual(new Set(["lector.fs"]));
	});

	it("denies a contribution when hasApi:false", () => {
		const workspace = workspaceWithSurfaces([["s1", TERMINAL]]);
		const getIntegration = integrations({ id: TERMINAL, title: "Terminal", capabilities: { renderable: true, hasApi: false } });
		const getContribution = contributions({ integrationId: TERMINAL, toolId: "terminal.exec" });
		expect(deriveWorkspaceToolIds(workspace, getIntegration, getContribution)).toEqual(new Set());
	});

	it("denies a contribution for an unknown Integration id", () => {
		const workspace = workspaceWithSurfaces([["s1", LECTOR]]);
		const getContribution = contributions({ integrationId: LECTOR, toolId: "lector.fs" });
		expect(deriveWorkspaceToolIds(workspace, () => undefined, getContribution)).toEqual(new Set());
	});

	it("returns empty when hasApi:true but no contribution registered", () => {
		const workspace = workspaceWithSurfaces([["s1", LECTOR]]);
		const getIntegration = integrations({ id: LECTOR, title: "Lector", capabilities: { renderable: true, hasApi: true } });
		expect(deriveWorkspaceToolIds(workspace, getIntegration, () => undefined)).toEqual(new Set());
	});

	it("dedupes a tool contributed by two Surfaces of the same Integration", () => {
		const workspace = workspaceWithSurfaces([
			["s1", LECTOR],
			["s2", LECTOR],
		]);
		const getIntegration = integrations({ id: LECTOR, title: "Lector", capabilities: { renderable: true, hasApi: true } });
		const getContribution = contributions({ integrationId: LECTOR, toolId: "lector.fs" });
		expect(deriveWorkspaceToolIds(workspace, getIntegration, getContribution)).toEqual(new Set(["lector.fs"]));
	});

	it("collects tools from multiple Integrations", () => {
		const workspace = workspaceWithSurfaces([
			["s1", LECTOR],
			["s2", TERMINAL],
		]);
		const getIntegration = integrations(
			{ id: LECTOR, title: "Lector", capabilities: { renderable: true, hasApi: true } },
			{ id: TERMINAL, title: "Terminal", capabilities: { renderable: true, hasApi: true } },
		);
		const getContribution = contributions({ integrationId: LECTOR, toolId: "lector.fs" }, { integrationId: TERMINAL, toolId: "terminal.exec" });
		expect(deriveWorkspaceToolIds(workspace, getIntegration, getContribution)).toEqual(new Set(["lector.fs", "terminal.exec"]));
	});
});

describe("diffToolIds", () => {
	it("reports an addition", () => {
		expect(diffToolIds(new Set(), new Set(["lector.fs"]))).toEqual({ added: ["lector.fs"], removed: [] });
	});

	it("reports a removal", () => {
		expect(diffToolIds(new Set(["lector.fs"]), new Set())).toEqual({ added: [], removed: ["lector.fs"] });
	});

	it("reports no change for identical sets", () => {
		expect(diffToolIds(new Set(["lector.fs"]), new Set(["lector.fs"]))).toEqual({ added: [], removed: [] });
	});

	it("reports both an addition and a removal in one transition", () => {
		expect(diffToolIds(new Set(["lector.fs"]), new Set(["terminal.exec"]))).toEqual({ added: ["terminal.exec"], removed: ["lector.fs"] });
	});

	it("ignores element order", () => {
		expect(diffToolIds(new Set(["a", "b"]), new Set(["b", "a"]))).toEqual({ added: [], removed: [] });
	});
});
