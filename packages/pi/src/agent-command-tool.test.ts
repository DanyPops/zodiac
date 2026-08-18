import { describe, expect, it, vi } from "vitest";
import { createAgentCommandTool } from "./agent-command-tool.js";

/**
 * ToolDefinition.execute takes 5 params (signal/onUpdate/ctx besides
 * toolCallId/params) -- this tool's own impl ignores all three, so tests
 * don't need real values for them. `execute as (...) => Promise<{content}>`
 * sidesteps ToolDefinition's own generic schema parameter, which resists a
 * precise structural type here without pulling in typebox's Static<T>.
 */
function run(toolDefinition: { execute: unknown }, toolCallId: string, params: unknown): Promise<{ content: { type: string; text: string }[] }> {
	return (toolDefinition.execute as (toolCallId: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<{ content: { type: string; text: string }[] }>)(toolCallId, params, undefined, undefined, {});
}

const ACTIVITY = { id: "activity", title: "Activity", capabilities: { renderable: true, hasApi: true } };

function fakeFetcher(worldByWorkspace: Record<string, readonly string[]>, postOutcome: { ok: boolean; body?: unknown } = { ok: true, body: {} }): typeof fetch {
	return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/api/world")) {
			const workspaces = Object.entries(worldByWorkspace).map(([id, activeIntegrationIds]) => ({ id, activeIntegrationIds }));
			return new Response(JSON.stringify({ state: "ready", workspaces, activeWorkspaceId: workspaces[0]?.id ?? null }), { status: 200 });
		}
		if (url.endsWith("/api/world/commands")) {
			return new Response(JSON.stringify(postOutcome.body ?? {}), { status: postOutcome.ok ? 200 : 500 });
		}
		throw new Error(`unexpected fetch to ${url} (init: ${JSON.stringify(init)})`);
	}) as unknown as typeof fetch;
}

function tool(options: { fetcher: typeof fetch; allowedCommandTypes?: readonly string[] }) {
	return createAgentCommandTool({
		daemonUrl: "http://daemon.local",
		grant: { workspaceId: "ws-1" as never, allowedCommandTypes: new Set((options.allowedCommandTypes ?? ["integration.invoke", "surface.dock"]) as never[]) },
		sessionPolicy: { allowed: true },
		getIntegration: (id) => (id === ACTIVITY.id ? (ACTIVITY as never) : undefined),
		fetcher: options.fetcher,
	});
}

describe("createAgentCommandTool -- integration.invoke live dock check", () => {
	it("allows integration.invoke when the daemon's live world reports the target Integration docked in that Workspace", async () => {
		const fetcher = fakeFetcher({ "ws-1": ["activity"] });
		const result = await run(tool({ fetcher }), "call-1", { type: "integration.invoke", workspaceId: "ws-1", integrationId: "activity", action: "do-thing", input: {} });
		expect(result.content[0]).toMatchObject({ type: "text" });
	});

	it("denies integration.invoke when the daemon's live world reports the target Integration NOT docked in that Workspace, even though it declares hasApi and the command type is granted", async () => {
		const fetcher = fakeFetcher({ "ws-1": [] });
		await expect(run(tool({ fetcher }), "call-1", { type: "integration.invoke", workspaceId: "ws-1", integrationId: "activity", action: "do-thing", input: {} })).rejects.toThrow(/integration-not-docked/);
	});

	it("re-fetches the live world on every call -- undocking between two calls changes the second call's outcome", async () => {
		const worldByWorkspace: Record<string, readonly string[]> = { "ws-1": ["activity"] };
		const fetcher = fakeFetcher(worldByWorkspace);
		const t = tool({ fetcher });

		await expect(run(t, "call-1", { type: "integration.invoke", workspaceId: "ws-1", integrationId: "activity", action: "a", input: {} })).resolves.toBeDefined();

		worldByWorkspace["ws-1"] = [];
		await expect(run(t, "call-2", { type: "integration.invoke", workspaceId: "ws-1", integrationId: "activity", action: "a", input: {} })).rejects.toThrow(/integration-not-docked/);
	});

	it("never fetches /api/world for a non-integration.invoke command -- no wasted network call", async () => {
		const fetcher = fakeFetcher({ "ws-1": [] });
		await run(tool({ fetcher }), "call-1", { type: "surface.dock", workspaceId: "ws-1", integrationId: "activity", title: "Activity" });
		const calledUrls = (fetcher as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
		expect(calledUrls.some((url) => url.endsWith("/api/world"))).toBe(false);
	});

	it("a Workspace absent from the live world entirely reports not-docked rather than throwing", async () => {
		const fetcher = fakeFetcher({});
		await expect(run(tool({ fetcher }), "call-1", { type: "integration.invoke", workspaceId: "ws-1", integrationId: "activity", action: "a", input: {} })).rejects.toThrow(/integration-not-docked/);
	});

	it("docking the same Integration in one Workspace never grants it in a sibling Workspace -- no process-global leakage", async () => {
		const fetcher = fakeFetcher({ "ws-1": ["activity"], "ws-2": [] });

		await expect(run(tool({ fetcher }), "call-1", { type: "integration.invoke", workspaceId: "ws-1", integrationId: "activity", action: "a", input: {} })).resolves.toBeDefined();
		await expect(
			run(createAgentCommandTool({
				daemonUrl: "http://daemon.local",
				grant: { workspaceId: "ws-2" as never, allowedCommandTypes: new Set(["integration.invoke"] as never[]) },
				sessionPolicy: { allowed: true },
				getIntegration: (id) => (id === ACTIVITY.id ? (ACTIVITY as never) : undefined),
				fetcher,
			}), "call-2", { type: "integration.invoke", workspaceId: "ws-2", integrationId: "activity", action: "a", input: {} }),
		).rejects.toThrow(/integration-not-docked/);
	});
});
