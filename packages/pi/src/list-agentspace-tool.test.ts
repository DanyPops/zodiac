import { describe, expect, it, vi } from "vitest";
import { integrationId } from "@zodiac/protocol";
import { createListAgentSpaceTool } from "./list-agentspace-tool.js";

function run(toolDefinition: { execute: unknown }, toolCallId: string, params: unknown): Promise<{ content: { type: string; text: string }[]; details: unknown }> {
	return (toolDefinition.execute as (toolCallId: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<{ content: { type: string; text: string }[]; details: unknown }>)(toolCallId, params, undefined, undefined, {});
}

const CALLABLE = { id: integrationId("callable"), title: "Callable", capabilities: { renderable: true, hasApi: true } };
const RENDER_ONLY = { id: integrationId("render-only"), title: "Render Only", capabilities: { renderable: true, hasApi: false } };
const UNDOCKED_CALLABLE = { id: integrationId("undocked"), title: "Undocked", capabilities: { renderable: false, hasApi: true } };

function fakeFetcher(dockedIds: readonly string[]): typeof fetch {
	return vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		if (url.endsWith("/api/world")) {
			return new Response(JSON.stringify({ state: "ready", workspaces: [{ id: "ws-1", activeIntegrationIds: dockedIds }], activeWorkspaceId: "ws-1" }), { status: 200 });
		}
		throw new Error(`unexpected fetch to ${url}`);
	}) as unknown as typeof fetch;
}

describe("createListAgentSpaceTool -- the strict, hasApi-gated subset of a Workspace's docked Integrations, the same fixture shape tool-grant.test.ts uses for deriveWorkspaceToolIds", () => {
	it("reports only the docked, hasApi Integration -- excludes a docked render-only one and an undocked callable one", async () => {
		const fetcher = fakeFetcher([CALLABLE.id, RENDER_ONLY.id]);
		const tool = createListAgentSpaceTool({ daemonUrl: "http://daemon.local", getAllIntegrations: () => [CALLABLE, RENDER_ONLY, UNDOCKED_CALLABLE], fetcher });
		const result = await run(tool, "call-1", { workspaceId: "ws-1" });
		const details = result.details as { agentSpace: { items: { id: string }[] } };
		expect(details.agentSpace.items.map((entry) => entry.id)).toEqual([CALLABLE.id]);
	});

	it("reports a real, honest empty AgentSpace when nothing docked is hasApi -- never an error", async () => {
		const fetcher = fakeFetcher([RENDER_ONLY.id]);
		const tool = createListAgentSpaceTool({ daemonUrl: "http://daemon.local", getAllIntegrations: () => [RENDER_ONLY], fetcher });
		const result = await run(tool, "call-1", { workspaceId: "ws-1" });
		const details = result.details as { agentSpace: { items: unknown[] } };
		expect(details.agentSpace.items).toEqual([]);
	});

	it("AgentSpace is always a subset of Workspace by construction -- every reported id is also in the docked set", async () => {
		const fetcher = fakeFetcher([CALLABLE.id]);
		const tool = createListAgentSpaceTool({ daemonUrl: "http://daemon.local", getAllIntegrations: () => [CALLABLE, UNDOCKED_CALLABLE], fetcher });
		const result = await run(tool, "call-1", { workspaceId: "ws-1" });
		const details = result.details as { agentSpace: { items: { id: string }[] } };
		expect(details.agentSpace.items.map((entry) => entry.id)).not.toContain(UNDOCKED_CALLABLE.id);
	});

	it("never mutates anything -- only ever GETs /api/world", async () => {
		const fetcher = fakeFetcher([CALLABLE.id]);
		await run(createListAgentSpaceTool({ daemonUrl: "http://daemon.local", getAllIntegrations: () => [CALLABLE], fetcher }), "call-1", { workspaceId: "ws-1" });
		const methods = (fetcher as ReturnType<typeof vi.fn>).mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method ?? "GET");
		expect(methods.every((method) => method === "GET")).toBe(true);
	});
});
