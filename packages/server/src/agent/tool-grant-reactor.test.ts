import { integrationId, workspaceId, worldId, type IntegrationDefinition } from "@zodiac/protocol";
import { describe, expect, it } from "vitest";
import { createWorldStore } from "../world/store.js";
import { createInMemoryToolRegistrar } from "./in-memory-tool-registrar.js";
import { watchWorkspaceToolGrants } from "./tool-grant-reactor.js";
import type { ToolContribution } from "./tool-grant.js";

const LECTOR = integrationId("lector");
const TERMINAL = integrationId("terminal");

function integrationRegistry(...defs: readonly IntegrationDefinition[]) {
	return (id: ReturnType<typeof integrationId>) => defs.find((definition) => definition.id === id);
}

function contributionRegistry(...defs: readonly ToolContribution[]) {
	return (id: ReturnType<typeof integrationId>) => defs.find((definition) => definition.integrationId === id);
}

describe("watchWorkspaceToolGrants", () => {
	it("grants a tool when a Surface for an hasApi Integration is docked", () => {
		const store = createWorldStore(worldId("w1"));
		const ws = workspaceId("ws-1");
		store.createWorkspace(ws, "Test");
		const registrar = createInMemoryToolRegistrar();
		const getIntegration = integrationRegistry({ id: LECTOR, title: "Lector", capabilities: { renderable: true, hasApi: true } });
		const getContribution = contributionRegistry({ integrationId: LECTOR, toolId: "lector.fs" });
		watchWorkspaceToolGrants(store, getIntegration, getContribution, registrar);

		store.dockSurface(ws, LECTOR, "Lector");

		expect(registrar.toolIds(ws)).toEqual(["lector.fs"]);
	});

	it("revokes a tool when its Surface is undocked", () => {
		const store = createWorldStore(worldId("w1"));
		const ws = workspaceId("ws-1");
		store.createWorkspace(ws, "Test");
		const registrar = createInMemoryToolRegistrar();
		const getIntegration = integrationRegistry({ id: LECTOR, title: "Lector", capabilities: { renderable: true, hasApi: true } });
		const getContribution = contributionRegistry({ integrationId: LECTOR, toolId: "lector.fs" });
		watchWorkspaceToolGrants(store, getIntegration, getContribution, registrar);

		const surface = store.dockSurface(ws, LECTOR, "Lector");
		expect(registrar.toolIds(ws)).toEqual(["lector.fs"]);

		store.undockSurface(ws, surface.id);
		expect(registrar.toolIds(ws)).toEqual([]);
	});

	it("grants nothing for an Integration without hasApi", () => {
		const store = createWorldStore(worldId("w1"));
		const ws = workspaceId("ws-1");
		store.createWorkspace(ws, "Test");
		const registrar = createInMemoryToolRegistrar();
		const getIntegration = integrationRegistry({ id: TERMINAL, title: "Terminal", capabilities: { renderable: true, hasApi: false } });
		const getContribution = contributionRegistry({ integrationId: TERMINAL, toolId: "terminal.exec" });
		watchWorkspaceToolGrants(store, getIntegration, getContribution, registrar);

		store.dockSurface(ws, TERMINAL, "Terminal");

		expect(registrar.toolIds(ws)).toEqual([]);
	});

	it("keeps grants isolated per Workspace", () => {
		const store = createWorldStore(worldId("w1"));
		const wsA = workspaceId("ws-a");
		const wsB = workspaceId("ws-b");
		store.createWorkspace(wsA, "A");
		store.createWorkspace(wsB, "B");
		const registrar = createInMemoryToolRegistrar();
		const getIntegration = integrationRegistry({ id: LECTOR, title: "Lector", capabilities: { renderable: true, hasApi: true } });
		const getContribution = contributionRegistry({ integrationId: LECTOR, toolId: "lector.fs" });
		watchWorkspaceToolGrants(store, getIntegration, getContribution, registrar);

		store.dockSurface(wsA, LECTOR, "Lector");

		expect(registrar.toolIds(wsA)).toEqual(["lector.fs"]);
		expect(registrar.toolIds(wsB)).toEqual([]);
	});

	it("stops reconciling once unsubscribed", () => {
		const store = createWorldStore(worldId("w1"));
		const ws = workspaceId("ws-1");
		store.createWorkspace(ws, "Test");
		const registrar = createInMemoryToolRegistrar();
		const getIntegration = integrationRegistry({ id: LECTOR, title: "Lector", capabilities: { renderable: true, hasApi: true } });
		const getContribution = contributionRegistry({ integrationId: LECTOR, toolId: "lector.fs" });
		const unsubscribe = watchWorkspaceToolGrants(store, getIntegration, getContribution, registrar);

		unsubscribe();
		store.dockSurface(ws, LECTOR, "Lector");

		expect(registrar.toolIds(ws)).toEqual([]);
	});
});
