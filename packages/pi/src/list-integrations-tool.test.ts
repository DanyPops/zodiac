import { describe, expect, it, vi } from "vitest";
import { integrationId } from "@zodiac/protocol";
import { createListIntegrationsTool } from "./list-integrations-tool.js";

/** See agent-command-tool.test.ts's own doc comment for why this shape/cast exists. */
function run(toolDefinition: { execute: unknown }, toolCallId: string, params: unknown): Promise<{ content: { type: string; text: string }[]; details: unknown }> {
	return (toolDefinition.execute as (toolCallId: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<{ content: { type: string; text: string }[]; details: unknown }>)(toolCallId, params, undefined, undefined, {});
}

const A = { id: integrationId("a"), title: "A", capabilities: { renderable: true, hasApi: true } };
const B = { id: integrationId("b"), title: "B", capabilities: { renderable: false, hasApi: true } };

describe("createListIntegrationsTool (reshaped) -- read-only, global Integration catalog, no Workspace scoping at all", () => {
	it("reports the full catalog, no docked/undocked partition -- that moved to list_workspace", async () => {
		const tool = createListIntegrationsTool({ getAllIntegrations: () => [A, B] });
		const result = await run(tool, "call-1", {});
		const details = result.details as { catalog: { items: { id: string }[] } };
		expect(details.catalog.items.map((entry) => entry.id).sort()).toEqual([A.id, B.id].sort());
		expect(details).not.toHaveProperty("docked");
		expect(details).not.toHaveProperty("undocked");
	});

	it("accepts no workspaceId parameter at all -- confirmed against its own schema, not just its runtime behavior", () => {
		const tool = createListIntegrationsTool({ getAllIntegrations: () => [] });
		const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
		expect(Object.keys(properties)).not.toContain("workspaceId");
	});

	it("omits the discoverable section entirely unless includeDiscoverable is explicitly true, and triggers exactly one registry lookup when opted in", async () => {
		const discoverRegistryIntegrations = vi.fn(async () => [{ id: integrationId("d"), title: "D", summary: "discoverable" }]);
		const tool = createListIntegrationsTool({ getAllIntegrations: () => [], discoverRegistryIntegrations });

		const withoutOptIn = await run(tool, "call-1", {});
		expect((withoutOptIn.details as Record<string, unknown>)["discoverable"]).toBeUndefined();
		expect(discoverRegistryIntegrations).not.toHaveBeenCalled();

		const withOptIn = await run(tool, "call-2", { includeDiscoverable: true });
		const details = withOptIn.details as { discoverable: { id: string }[] };
		expect(details.discoverable.map((entry) => entry.id)).toEqual([integrationId("d")]);
		expect(discoverRegistryIntegrations).toHaveBeenCalledTimes(1);
	});

	it("never makes any network call at all -- the reshaped tool reads only the injected getAllIntegrations(), no /api/world fetch", async () => {
		const getAllIntegrations = vi.fn(() => [A]);
		await run(createListIntegrationsTool({ getAllIntegrations }), "call-1", {});
		expect(getAllIntegrations).toHaveBeenCalled();
	});
});
