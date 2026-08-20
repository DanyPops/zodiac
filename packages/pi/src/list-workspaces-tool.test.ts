import { describe, expect, it, vi } from "vitest";
import { createListWorkspacesTool } from "./list-workspaces-tool.js";

function run(toolDefinition: { execute: unknown }, toolCallId: string, params: unknown): Promise<{ content: { type: string; text: string }[]; details: unknown }> {
	return (toolDefinition.execute as (toolCallId: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<{ content: { type: string; text: string }[]; details: unknown }>)(toolCallId, params, undefined, undefined, {});
}

function fakeFetcher(workspaces: readonly { id: string; title: string }[]): typeof fetch {
	return vi.fn(async (input: string | URL | Request) => {
		const url = String(input);
		if (url.endsWith("/api/world")) {
			return new Response(JSON.stringify({ state: "ready", workspaces, activeWorkspaceId: workspaces[0]?.id ?? null }), { status: 200 });
		}
		throw new Error(`unexpected fetch to ${url}`);
	}) as unknown as typeof fetch;
}

describe("createListWorkspacesTool -- read-only, global Workspace metadata list", () => {
	it("reports every real Workspace present in the live World snapshot", async () => {
		const fetcher = fakeFetcher([{ id: "ws-a", title: "Alpha" }, { id: "ws-b", title: "Beta" }]);
		const tool = createListWorkspacesTool({ daemonUrl: "http://daemon.local", fetcher });
		const result = await run(tool, "call-1", {});
		const details = result.details as { workspaces: { id: string; title: string }[] };
		expect(details.workspaces).toEqual([{ id: "ws-a", title: "Alpha" }, { id: "ws-b", title: "Beta" }]);
	});

	it("reports an empty list for a still-empty World -- a real, honest answer, never an error", async () => {
		const fetcher = fakeFetcher([]);
		const tool = createListWorkspacesTool({ daemonUrl: "http://daemon.local", fetcher });
		const result = await run(tool, "call-1", {});
		const details = result.details as { workspaces: unknown[] };
		expect(details.workspaces).toEqual([]);
	});

	it("accepts no workspaceId parameter -- global, not scoped to any one Workspace", () => {
		const tool = createListWorkspacesTool({ daemonUrl: "http://daemon.local" });
		const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
		expect(Object.keys(properties)).toEqual([]);
	});

	it("never mutates anything -- only ever GETs /api/world", async () => {
		const fetcher = fakeFetcher([{ id: "ws-a", title: "Alpha" }]);
		await run(createListWorkspacesTool({ daemonUrl: "http://daemon.local", fetcher }), "call-1", {});
		const methods = (fetcher as ReturnType<typeof vi.fn>).mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method ?? "GET");
		expect(methods.every((method) => method === "GET")).toBe(true);
	});
});
