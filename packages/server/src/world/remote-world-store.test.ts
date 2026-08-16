import { describe, expect, it, vi } from "vitest";
import { workspaceId } from "@zodiac/protocol";
import type { WorldViewModel } from "@zodiac/protocol";
import { connectRemoteWorldStore } from "./remote-world-store.js";

const EMPTY: WorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };

/**
 * A fake zodiacd, real enough to exercise connectRemoteWorldStore's own
 * three routes: GET /api/world (current snapshot), GET /api/world/events
 * (SSE broadcast, a real ReadableStream this test controls directly), and
 * POST /api/world/commands (records what was dispatched).
 */
function createFakeDaemon(initial: WorldViewModel) {
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const encoder = new TextEncoder();
	const posted: unknown[] = [];
	let eventsRequests = 0;

	function push(viewModel: WorldViewModel): void {
		controller?.enqueue(encoder.encode(`data: ${JSON.stringify(viewModel)}\n\n`));
	}

	function closeStream(): void {
		controller?.close();
		controller = undefined;
	}

	const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/api/world") && (!init || init.method === undefined)) {
			return new Response(JSON.stringify(initial), { status: 200 });
		}
		if (url.endsWith("/api/world/events")) {
			eventsRequests += 1;
			const stream = new ReadableStream<Uint8Array>({
				start(c) {
					controller = c;
				},
			});
			return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
		}
		if (url.endsWith("/api/world/commands") && init?.method === "POST") {
			posted.push(JSON.parse(String(init.body)));
			return new Response(JSON.stringify({ accepted: true }), { status: 200 });
		}
		throw new Error(`fake daemon: unhandled request ${url}`);
	});

	return { fetcher, push, closeStream, posted, eventsRequestCount: () => eventsRequests };
}

describe("connectRemoteWorldStore", () => {
	it("returns the current snapshot from GET /api/world as its own initial worldViewModel()", async () => {
		const daemon = createFakeDaemon(EMPTY);
		const store = await connectRemoteWorldStore({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		expect(store.worldViewModel()).toEqual(EMPTY);
		store.dispose();
	});

	it("updates worldViewModel() and notifies onChange as SSE frames arrive", async () => {
		const daemon = createFakeDaemon(EMPTY);
		const store = await connectRemoteWorldStore({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		const seen: WorldViewModel[] = [];
		store.onChange((viewModel) => seen.push(viewModel));

		const ready: WorldViewModel = { state: "ready", workspaces: [], activeWorkspaceId: workspaceId("w1") };
		daemon.push(ready);
		await vi.waitFor(() => expect(store.worldViewModel()).toEqual(ready));
		expect(seen).toEqual([ready]);
		store.dispose();
	});

	it("apply() POSTs the given CommandIntent to /api/world/commands", async () => {
		const daemon = createFakeDaemon(EMPTY);
		const store = await connectRemoteWorldStore({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		store.apply({ type: "workspace.create", workspaceId: workspaceId("w1"), title: "Bug Triage" });
		await vi.waitFor(() => expect(daemon.posted).toHaveLength(1));
		expect(daemon.posted[0]).toEqual({ intent: { type: "workspace.create", workspaceId: "w1", title: "Bug Triage" } });
		store.dispose();
	});

	it("workspaceViewModel() looks up a workspace from the last-known snapshot", async () => {
		const withWorkspace: WorldViewModel = {
			state: "ready",
			activeWorkspaceId: workspaceId("w1"),
			workspaces: [{ id: workspaceId("w1"), title: "Bug Triage", windows: [], activeWindowIndex: 0 }] as unknown as WorldViewModel["workspaces"],
		};
		const daemon = createFakeDaemon(withWorkspace);
		const store = await connectRemoteWorldStore({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		expect(store.workspaceViewModel(workspaceId("w1"))?.title).toBe("Bug Triage");
		expect(store.workspaceViewModel(workspaceId("missing"))).toBeUndefined();
		store.dispose();
	});

	it("rejects if the initial GET /api/world never resolves within connectTimeoutMs", async () => {
		const hangingFetcher = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
			});
		});
		await expect(connectRemoteWorldStore({ baseUrl: "http://fake", fetcher: hangingFetcher as unknown as typeof fetch, connectTimeoutMs: 10 })).rejects.toThrow();
	});

	it("rejects if the initial GET /api/world returns a non-2xx status", async () => {
		const fetcher = vi.fn(async () => new Response("nope", { status: 500 }));
		await expect(connectRemoteWorldStore({ baseUrl: "http://fake", fetcher: fetcher as unknown as typeof fetch })).rejects.toThrow(/500/);
	});

	// The daemon-only members of WorldStore (snapshot/getWorkspace/createWorkspace/
	// dockSurface/undockSurface/dockSurfaceInto/windowTile) no longer exist on
	// connectRemoteWorldStore's own return type (WorldClientPort) at all -- the
	// invariant a runtime "not supported" throw used to protect is now enforced
	// at compile time instead, a strictly stronger guarantee. See
	// world-client-port.ts's own doc comment.

	it("reconnects the SSE stream after it drops, and the reconnect's own first frame resyncs state (idempotent by construction)", async () => {
		const daemon = createFakeDaemon(EMPTY);
		const store = await connectRemoteWorldStore({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		daemon.closeStream();
		await vi.waitFor(() => expect(daemon.eventsRequestCount()).toBeGreaterThanOrEqual(2), { timeout: 3_000, interval: 50 });
		const ready: WorldViewModel = { state: "ready", workspaces: [], activeWorkspaceId: workspaceId("w1") };
		daemon.push(ready);
		await vi.waitFor(() => expect(store.worldViewModel()).toEqual(ready));
		store.dispose();
	});

	it("dispose() stops delivering further onChange notifications", async () => {
		const daemon = createFakeDaemon(EMPTY);
		const store = await connectRemoteWorldStore({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		const seen: WorldViewModel[] = [];
		store.onChange((viewModel) => seen.push(viewModel));
		store.dispose();
		daemon.push({ state: "ready", workspaces: [], activeWorkspaceId: workspaceId("w1") });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(seen).toEqual([]);
	});
});
