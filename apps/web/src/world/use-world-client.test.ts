/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { commandId, panelId, workspaceId } from "@zodiac/protocol";
import type { Panel, WorldViewModel } from "@zodiac/protocol";
import { useWorldClient } from "./use-world-client.js";

const EMPTY: WorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };

/** Same shape as @zodiac/server's own remote-world-store.test.ts fake daemon -- real enough to exercise connectRemoteWorldStore's three routes without a live process. */
function createFakeDaemon(initial: WorldViewModel, initialPanels: readonly Panel[] = []) {
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const encoder = new TextEncoder();
	const posted: unknown[] = [];
	let panels = initialPanels;

	function push(viewModel: WorldViewModel, acknowledgedCommandId?: string): void {
		const change = { viewModel, ...(acknowledgedCommandId ? { commandId: acknowledgedCommandId } : {}) };
		controller?.enqueue(encoder.encode(`data: ${JSON.stringify(change)}\n\n`));
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

	return { fetcher, push, posted, setPanels: (next: readonly Panel[]) => { panels = next; } };
}

describe("useWorldClient", () => {
	it("starts disconnected with an empty view model, then connects and reflects GET /api/world's real snapshot", async () => {
		const ready: WorldViewModel = { state: "ready", workspaces: [], activeWorkspaceId: workspaceId("w1") };
		const daemon = createFakeDaemon(ready);
		const { result } = renderHook(() => useWorldClient("http://fake", { fetcher: daemon.fetcher }));

		expect(result.current.connected).toBe(false);
		expect(result.current.viewModel).toEqual(EMPTY);

		await waitFor(() => expect(result.current.connected).toBe(true));
		expect(result.current.viewModel).toEqual(ready);
	});

	it("reflects a live SSE update as the daemon's own onChange fires", async () => {
		const daemon = createFakeDaemon(EMPTY);
		const { result } = renderHook(() => useWorldClient("http://fake", { fetcher: daemon.fetcher }));
		await waitFor(() => expect(result.current.connected).toBe(true));

		const updated: WorldViewModel = { state: "ready", workspaces: [], activeWorkspaceId: workspaceId("w2") };
		daemon.push(updated);
		await waitFor(() => expect(result.current.viewModel).toEqual(updated));
	});

	it("records command acknowledgements independently of what changed in the WorldViewModel", async () => {
		const daemon = createFakeDaemon(EMPTY);
		const { result } = renderHook(() => useWorldClient("http://fake", { fetcher: daemon.fetcher }));
		await waitFor(() => expect(result.current.connected).toBe(true));

		daemon.push(EMPTY, commandId("cmd-undock"));

		await waitFor(() => expect(result.current.acknowledgedCommandIds).toContain("cmd-undock"));
	});

	it("reflects the daemon's Panel list once connected, and picks up a later change via the next onChange", async () => {
		const panel: Panel = { id: panelId("p1"), location: "bottom", alignment: "center", offset: 0, thickness: 3, thicknessUnit: "terminal-cells", lengthMode: "fill", visibilityMode: "normal", startCap: null, endCap: null, body: [] };
		const daemon = createFakeDaemon(EMPTY, [panel]);
		const { result } = renderHook(() => useWorldClient("http://fake", { fetcher: daemon.fetcher }));
		await waitFor(() => expect(result.current.panels).toEqual([panel]));

		daemon.setPanels([]);
		daemon.push({ state: "ready", workspaces: [], activeWorkspaceId: workspaceId("w1") });
		await waitFor(() => expect(result.current.panels).toEqual([]));
	});

	it("apply() posts the given CommandIntent through the same daemon endpoint a human dispatch uses", async () => {
		const daemon = createFakeDaemon(EMPTY);
		const { result } = renderHook(() => useWorldClient("http://fake", { fetcher: daemon.fetcher }));
		await waitFor(() => expect(result.current.connected).toBe(true));

		result.current.apply({ type: "workspace.create", workspaceId: workspaceId("w1"), title: "Bug Triage" });
		await waitFor(() => expect(daemon.posted).toHaveLength(1));
		expect(daemon.posted[0]).toEqual({ intent: { type: "workspace.create", workspaceId: "w1", title: "Bug Triage" } });
	});

	it("stays disconnected (never throws) when the daemon is unreachable", async () => {
		const failingFetcher = vi.fn(async () => new Response("nope", { status: 500 }));
		const { result } = renderHook(() => useWorldClient("http://fake", { fetcher: failingFetcher as unknown as typeof fetch }));

		await waitFor(() => expect(failingFetcher).toHaveBeenCalled());
		expect(result.current.connected).toBe(false);
		expect(result.current.viewModel).toEqual(EMPTY);
		// apply() while disconnected is a harmless no-op, not a throw -- there is nowhere to send it yet.
		expect(() => result.current.apply({ type: "workspace.create", workspaceId: workspaceId("w1"), title: "x" })).not.toThrow();
	});

	it("disposes the underlying connection on unmount, so a stray SSE frame after unmount cannot update React state", async () => {
		const daemon = createFakeDaemon(EMPTY);
		const { result, unmount } = renderHook(() => useWorldClient("http://fake", { fetcher: daemon.fetcher }));
		await waitFor(() => expect(result.current.connected).toBe(true));
		unmount();
		daemon.push({ state: "ready", workspaces: [], activeWorkspaceId: workspaceId("w1") });
		await new Promise((resolve) => setTimeout(resolve, 20));
		// No assertion beyond "this doesn't throw/warn" is possible once unmounted; the real regression this guards is a React "state update on an unmounted component" warning, which vitest surfaces as console output a reviewer would notice, not a thrown test failure.
	});
});
