import { describe, expect, it, vi } from "vitest";
import { commandId, panelId, workspaceId } from "@zodiac/protocol";
import type { Panel, WorldViewModel } from "@zodiac/protocol";
import { connectRemoteWorldStore, postCommandIntent } from "./remote-world-store.js";

const EMPTY: WorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };

/**
 * A fake zodiacd, real enough to exercise connectRemoteWorldStore's own
 * three routes: GET /api/world (current snapshot), GET /api/world/events
 * (SSE broadcast, a real ReadableStream this test controls directly), and
 * POST /api/world/commands (records what was dispatched).
 */
function createFakeDaemon(initial: WorldViewModel, initialPanels: readonly Panel[] = []) {
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const encoder = new TextEncoder();
	const posted: unknown[] = [];
	let eventsRequests = 0;
	let panels = initialPanels;

	function push(viewModel: WorldViewModel): void {
		controller?.enqueue(encoder.encode(`data: ${JSON.stringify(viewModel)}\n\n`));
	}

	function closeStream(): void {
		controller?.close();
		controller = undefined;
	}

	const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/api/world/panels")) {
			return new Response(JSON.stringify({ panels }), { status: 200 });
		}
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

	return { fetcher, push, closeStream, posted, eventsRequestCount: () => eventsRequests, setPanels: (next: readonly Panel[]) => { panels = next; } };
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
		// Fires once for the frame itself, and again once its own background
		// Panel-list refresh lands (see connectRemoteWorldStore's own doc
		// comment) -- every call still carries this same ready WorldViewModel.
		await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(1));
		for (const viewModel of seen) expect(viewModel).toEqual(ready);
		store.dispose();
	});

	it("panels() returns the daemon's Panel list fetched at connect", async () => {
		const panel: Panel = { id: panelId("p1"), location: "bottom", alignment: "center", offset: 0, thickness: 3, thicknessUnit: "terminal-cells", lengthMode: "fill", visibilityMode: "normal", startCap: null, endCap: null, body: [] };
		const daemon = createFakeDaemon(EMPTY, [panel]);
		const store = await connectRemoteWorldStore({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		expect(store.panels()).toEqual([panel]);
		store.dispose();
	});

	it("panels() picks up a change once an unrelated WorldViewModel change also arrives over SSE", async () => {
		const panel: Panel = { id: panelId("p1"), location: "bottom", alignment: "center", offset: 0, thickness: 3, thicknessUnit: "terminal-cells", lengthMode: "fill", visibilityMode: "normal", startCap: null, endCap: null, body: [] };
		const daemon = createFakeDaemon(EMPTY, []);
		const store = await connectRemoteWorldStore({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		expect(store.panels()).toEqual([]);

		daemon.setPanels([panel]);
		daemon.push({ state: "ready", workspaces: [], activeWorkspaceId: workspaceId("w1") });
		await vi.waitFor(() => expect(store.panels()).toEqual([panel]));
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

	it("apply() posts the intent's own commandId when the caller supplies one", async () => {
		const daemon = createFakeDaemon(EMPTY);
		const store = await connectRemoteWorldStore({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		store.apply({ type: "workspace.create", workspaceId: workspaceId("w1"), title: "Bug Triage", commandId: commandId("cmd-1") });
		await vi.waitFor(() => expect(daemon.posted).toHaveLength(1));
		expect(daemon.posted[0]).toEqual({ intent: { type: "workspace.create", workspaceId: "w1", title: "Bug Triage", commandId: "cmd-1" } });
		store.dispose();
	});

	it("apply() includes the commandId in its diagnostic log when the daemon rejects the command", async () => {
		const rejectingFetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith("/api/world") && (!init || init.method === undefined)) return new Response(JSON.stringify(EMPTY), { status: 200 });
			if (url.endsWith("/api/world/events")) return new Response(new ReadableStream(), { status: 200 });
			if (url.endsWith("/api/world/commands")) return new Response(JSON.stringify({ code: "command-failed" }), { status: 400 });
			throw new Error(`unhandled request ${url}`);
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const store = await connectRemoteWorldStore({ baseUrl: "http://fake", fetcher: rejectingFetcher as unknown as typeof fetch });
		store.apply({ type: "window.next", workspaceId: workspaceId("w1"), commandId: commandId("cmd-attributable") });
		await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
		expect(errorSpy.mock.calls[0]?.[0]).toContain("cmd-attributable");
		errorSpy.mockRestore();
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

	it("postCommandIntent returns the daemon's echoed commandId/result on success", async () => {
		const fetcher = vi.fn(async () => new Response(JSON.stringify({ accepted: true, commandId: "cmd-1", result: { surfaceId: "surface-9" } }), { status: 200 }));
		const outcome = await postCommandIntent("http://fake", { type: "surface.dock", workspaceId: workspaceId("w1"), integrationId: "activity" as never, title: "Activity" }, fetcher as unknown as typeof fetch);
		expect(outcome).toEqual({ accepted: true, commandId: "cmd-1", surfaceId: "surface-9" });
	});

	it("postCommandIntent returns a rejection with the daemon's own message on a non-2xx response", async () => {
		const fetcher = vi.fn(async () => new Response(JSON.stringify({ message: "surface-id-collision" }), { status: 400 }));
		const outcome = await postCommandIntent("http://fake", { type: "window.next", workspaceId: workspaceId("w1") }, fetcher as unknown as typeof fetch);
		expect(outcome).toEqual({ accepted: false, message: "surface-id-collision" });
	});

	it("postCommandIntent returns a rejection, not a throw, when the fetch itself fails", async () => {
		const fetcher = vi.fn(async () => { throw new Error("network down"); });
		const outcome = await postCommandIntent("http://fake", { type: "window.next", workspaceId: workspaceId("w1") }, fetcher as unknown as typeof fetch);
		expect(outcome).toEqual({ accepted: false, message: "network down" });
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
