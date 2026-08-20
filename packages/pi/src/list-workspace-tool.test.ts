import { describe, expect, it, vi } from "vitest";
import { integrationId } from "@zodiac/protocol";
import { createListWorkspaceTool } from "./list-workspace-tool.js";

/** See agent-command-tool.test.ts's own doc comment for why this shape/cast exists. */
function run(toolDefinition: { execute: unknown }, toolCallId: string, params: unknown): Promise<{ content: { type: string; text: string }[]; details: unknown }> {
	return (toolDefinition.execute as (toolCallId: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<{ content: { type: string; text: string }[]; details: unknown }>)(toolCallId, params, undefined, undefined, {});
}

const A = { id: integrationId("a"), title: "A", capabilities: { renderable: true, hasApi: true } };
const B = { id: integrationId("b"), title: "B", capabilities: { renderable: false, hasApi: true } };
const C = { id: integrationId("c"), title: "C", capabilities: { renderable: true, hasApi: false } };

function fakeFetcher(worldByWorkspace: Record<string, readonly string[]>): typeof fetch {
	return vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		if (url.endsWith("/api/world")) {
			const workspaces = Object.entries(worldByWorkspace).map(([id, activeIntegrationIds]) => ({ id, activeIntegrationIds }));
			return new Response(JSON.stringify({ state: "ready", workspaces, activeWorkspaceId: workspaces[0]?.id ?? null }), { status: 200 });
		}
		throw new Error(`unexpected fetch to ${url}`);
	}) as unknown as typeof fetch;
}

describe("createListWorkspaceTool -- read-only, per-Workspace docked/undocked directory (relocated from list_integrations unchanged)", () => {
	it("reports A only as docked, B and C only as undocked -- never conflated, and includes a render-only Integration (C) even though the agent can't call it", async () => {
		const fetcher = fakeFetcher({ "ws-1": [A.id] });
		const tool = createListWorkspaceTool({ daemonUrl: "http://daemon.local", getAllIntegrations: () => [A, B, C], fetcher });
		const result = await run(tool, "call-1", { workspaceId: "ws-1" });
		const details = result.details as { docked: { items: { id: string }[] }; undocked: { items: { id: string }[] } };
		expect(details.docked.items.map((entry) => entry.id)).toEqual([A.id]);
		expect(details.undocked.items.map((entry) => entry.id)).toEqual([B.id, C.id]);
	});

	it("never mutates anything -- it only ever calls GET /api/world, never POSTs a command", async () => {
		const fetcher = fakeFetcher({ "ws-1": [A.id] });
		await run(createListWorkspaceTool({ daemonUrl: "http://daemon.local", getAllIntegrations: () => [A], fetcher }), "call-1", { workspaceId: "ws-1" });
		const methods = (fetcher as ReturnType<typeof vi.fn>).mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method ?? "GET");
		expect(methods.every((method) => method === "GET")).toBe(true);
	});

	it("scopes the docked/undocked split to the requested Workspace, not any other Workspace's own live state", async () => {
		const fetcher = fakeFetcher({ "ws-1": [A.id], "ws-2": [] });
		const tool = createListWorkspaceTool({ daemonUrl: "http://daemon.local", getAllIntegrations: () => [A], fetcher });
		const forWsTwo = await run(tool, "call-1", { workspaceId: "ws-2" });
		const details = forWsTwo.details as { docked: { items: unknown[] }; undocked: { items: { id: string }[] } };
		expect(details.docked.items).toHaveLength(0);
		expect(details.undocked.items.map((entry) => entry.id)).toEqual([A.id]);
	});
});
