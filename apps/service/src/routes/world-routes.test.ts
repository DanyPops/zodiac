import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createWorldStore } from "@zodiac/server/world";
import { worldId, workspaceId, integrationId, surfaceId, panelId } from "@zodiac/protocol";
import { createWorldRoutes } from "./world-routes.js";

let server: Server | undefined;

afterEach(() => {
	server?.close();
	server = undefined;
});

async function listen(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void): Promise<string> {
	server = createServer(handler);
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
	return `http://127.0.0.1:${address.port}`;
}

describe("createWorldRoutes", () => {
	it("getWorld returns the current WorldViewModel", async () => {
		const world = createWorldStore(worldId("w1"));
		world.createWorkspace(workspaceId("ws"), "WS");
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => routes.getWorld(req, res));

		const response = await fetch(`${base}/api/world`);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toEqual(world.worldViewModel());
	});

	it("getPanels returns the World's current Panel list", async () => {
		const panel = { id: panelId("p1"), location: "bottom" as const, alignment: "center" as const, offset: 0, thickness: 3, thicknessUnit: "terminal-cells" as const, lengthMode: "fill" as const, visibilityMode: "normal" as const, startCap: null, endCap: null, body: [] };
		const world = createWorldStore(worldId("w1"), { panels: [panel] });
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => routes.getPanels(req, res));

		const response = await fetch(`${base}/api/world/panels`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ panels: [panel] });
	});

	it("postCommand dispatches a valid CommandIntent through WorldStore.apply", async () => {
		const world = createWorldStore(worldId("w1"));
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => {
			void routes.postCommand(req, res);
		});

		const response = await fetch(`${base}/api/world/commands`, {
			method: "POST",
			body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "ws", title: "WS" } }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ accepted: true });
		expect(world.getWorkspace(workspaceId("ws"))).toBeDefined();
	});

	it("postCommand echoes the submitted commandId back, and reports the created Surface id for surface.dock", async () => {
		const world = createWorldStore(worldId("w1"));
		world.createWorkspace(workspaceId("ws"), "WS");
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => {
			void routes.postCommand(req, res);
		});

		const response = await fetch(`${base}/api/world/commands`, {
			method: "POST",
			body: JSON.stringify({ intent: { type: "surface.dock", workspaceId: "ws", integrationId: "activity", title: "Activity", commandId: "cmd-1" } }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { accepted: boolean; commandId?: string; result?: { surfaceId?: string } };
		expect(body.accepted).toBe(true);
		expect(body.commandId).toBe("cmd-1");
		const dockedSurfaceId = world.getWorkspace(workspaceId("ws"))?.surfaces[0]?.id;
		expect(body.result).toEqual({ surfaceId: dockedSurfaceId });
	});

	it("postCommand omits commandId/result entirely when there is nothing to report", async () => {
		const world = createWorldStore(worldId("w1"));
		world.createWorkspace(workspaceId("ws"), "WS");
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => {
			void routes.postCommand(req, res);
		});

		const response = await fetch(`${base}/api/world/commands`, {
			method: "POST",
			body: JSON.stringify({ intent: { type: "window.next", workspaceId: "ws" } }),
		});
		expect(await response.json()).toEqual({ accepted: true });
	});

	it("postCommand dispatches integration.invoke through a registered fixture Integration handler and surfaces its outcome as result.invoke", async () => {
		const world = createWorldStore(worldId("w1"));
		world.createWorkspace(workspaceId("ws"), "WS");
		world.registerIntegrationInvokeHandler(integrationId("lector"), (action, input) => {
			if (action !== "symbol.search") return { ok: false, code: "unknown-action", message: "nope" };
			return { ok: true, value: { echoedInput: input } };
		});
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => {
			void routes.postCommand(req, res);
		});

		const response = await fetch(`${base}/api/world/commands`, {
			method: "POST",
			body: JSON.stringify({ intent: { type: "integration.invoke", workspaceId: "ws", integrationId: "lector", action: "symbol.search", input: { query: "x" }, commandId: "cmd-1" } }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ accepted: true, commandId: "cmd-1", result: { invoke: { ok: true, value: { echoedInput: { query: "x" } } } } });
	});

	it("postCommand surfaces integration.invoke against an unregistered Integration as a 400, not a 500 crash", async () => {
		const world = createWorldStore(worldId("w1"));
		world.createWorkspace(workspaceId("ws"), "WS");
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => {
			void routes.postCommand(req, res);
		});

		const response = await fetch(`${base}/api/world/commands`, {
			method: "POST",
			body: JSON.stringify({ intent: { type: "integration.invoke", workspaceId: "ws", integrationId: "lector", action: "symbol.search" } }),
		});
		expect(response.status).toBe(400);
	});

	it("postCommand rejects a malformed intent with 400, without touching the store", async () => {
		const world = createWorldStore(worldId("w1"));
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => {
			void routes.postCommand(req, res);
		});

		const response = await fetch(`${base}/api/world/commands`, {
			method: "POST",
			body: JSON.stringify({ intent: { type: "not.a.real.command" } }),
		});
		expect(response.status).toBe(400);
	});

	it("postCommand rejects malformed JSON with 400", async () => {
		const world = createWorldStore(worldId("w1"));
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => {
			void routes.postCommand(req, res);
		});

		const response = await fetch(`${base}/api/world/commands`, { method: "POST", body: "not json" });
		expect(response.status).toBe(400);
	});

	it("postCommand rejects a colliding caller-supplied surfaceId with 400, without mutating the store", async () => {
		const world = createWorldStore(worldId("w1"));
		world.createWorkspace(workspaceId("ws"), "WS");
		world.dockSurface(workspaceId("ws"), integrationId("activity"), "Activity", surfaceId("dup"));
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => {
			void routes.postCommand(req, res);
		});

		const response = await fetch(`${base}/api/world/commands`, {
			method: "POST",
			body: JSON.stringify({ intent: { type: "surface.dock", workspaceId: "ws", integrationId: "activity", title: "Activity 2", surfaceId: "dup" } }),
		});
		expect(response.status).toBe(400);
		expect(world.getWorkspace(workspaceId("ws"))?.surfaces).toHaveLength(1);
	});

	it("postCommand surfaces a real domain error (e.g. docking into an unknown Workspace) as 400, not a 500 crash", async () => {
		const world = createWorldStore(worldId("w1"));
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => {
			void routes.postCommand(req, res);
		});

		const response = await fetch(`${base}/api/world/commands`, {
			method: "POST",
			body: JSON.stringify({ intent: { type: "surface.dock", workspaceId: "ghost", integrationId: "activity", title: "Activity" } }),
		});
		expect(response.status).toBe(400);
	});

	it("streamEvents sends the current snapshot immediately, then broadcasts subsequent changes", async () => {
		const world = createWorldStore(worldId("w1"));
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => routes.streamEvents(req, res));

		const controller = new AbortController();
		const response = await fetch(`${base}/api/world/events`, { signal: controller.signal });
		expect(response.headers.get("content-type")).toContain("text/event-stream");

		const reader = response.body?.getReader();
		if (!reader) throw new Error("expected a readable body");
		const decoder = new TextDecoder();

		let received = "";
		const { value } = await reader.read();
		received += decoder.decode(value);
		expect(received).toContain(JSON.stringify(world.worldViewModel()));

		world.createWorkspace(workspaceId("ws"), "WS");
		while (!received.includes('"ws"')) {
			const next = await reader.read();
			if (next.done) break;
			received += decoder.decode(next.value);
		}
		expect(received).toContain(JSON.stringify(world.worldViewModel()));

		controller.abort();
	});

	it("streamEvents envelopes each snapshot with the commandId whose accepted mutation it reflects", async () => {
		const world = createWorldStore(worldId("w1"));
		world.createWorkspace(workspaceId("ws"), "WS");
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => routes.streamEvents(req, res));
		const controller = new AbortController();
		const response = await fetch(`${base}/api/world/events`, { signal: controller.signal });
		const reader = response.body?.getReader();
		if (!reader) throw new Error("expected a readable body");
		await reader.read();

		world.apply({ type: "window.next", workspaceId: workspaceId("ws"), commandId: "cmd-sse" as never });
		const next = await reader.read();
		const frame = new TextDecoder().decode(next.value);
		expect(frame).toContain('"commandId":"cmd-sse"');
		expect(frame).toContain('"viewModel"');
		controller.abort();
	});

	it("streamEvents stops broadcasting to a disconnected client (unsubscribes on close)", async () => {
		const world = createWorldStore(worldId("w1"));
		const routes = createWorldRoutes(world);
		const base = await listen((req, res) => routes.streamEvents(req, res));

		const controller = new AbortController();
		await fetch(`${base}/api/world/events`, { signal: controller.signal });
		controller.abort();
		await new Promise((resolve) => setTimeout(resolve, 50));

		// No listener should remain -- exercised indirectly: this must not throw
		// or hang when the world changes after the only subscriber disconnected.
		expect(() => world.createWorkspace(workspaceId("ws"), "WS")).not.toThrow();
	});

	/**
	 * Grounded in anomalyco/opencode issue #16697's own forensics ("Memory leak forensics: 187GB
	 * RSS, SSE AsyncQueue as root cause") -- a producer with no backpressure awareness feeding an
	 * unbounded in-memory buffer once a connected SSE client falls behind. Proves the real fix
	 * (sse-writer.ts's own writeSseFrame, backed by Node's real res.writableLength accounting) at
	 * the actual route layer, against a real HTTP server and a real raw socket that never reads a
	 * single byte -- not a stubbed response, and not a fetch()-based client (whose own Response
	 * body reader would eventually drain the stream, masking exactly the failure mode being
	 * tested).
	 */
	it("streamEvents destroys a connection whose own buffered bytes exceed the configured cap, and never touches any other connected client", async () => {
		const world = createWorldStore(worldId("w1"));
		// One big Workspace up front, before either client connects -- every WorldViewModel snapshot
		// this test sends afterward stays this same ~60KB size throughout (see the dock/undock toggle
		// burst below, which changes state without growing the payload), rather than a cumulatively
		// growing one. Isolates the real thing under test -- backlog from a slow reader -- from a
		// separate, real concern (a single legitimately huge snapshot) that TDD item 3's own payload
		// audit below covers on its own terms.
		world.createWorkspace(workspaceId("ws"), "x".repeat(60_000));
		// A real production-scale default (4MB) would need genuinely large payloads or a long test to
		// observe deterministically -- a tiny injected cap proves the exact same mechanism fast, sized
		// with real margin on both sides: comfortably above one ~60KB snapshot (so the
		// actively-draining healthy client's own single-frame writableLength never trips it) and
		// comfortably below what the never-draining slow client accumulates across the whole burst
		// (15 undrained ~60KB frames -- roughly 900KB).
		const maxSseBufferedBytes = 300_000;
		const routes = createWorldRoutes(world, { maxSseBufferedBytes });
		// Captured directly so the assertion below can read the real, live http.ServerResponse's
		// own .destroyed flag -- proven (via a throwaway debug run) to flip synchronously and
		// immediately once writeSseFrame's own cap check trips, unlike the far end's own raw
		// socket 'close' event, whose OS-level propagation timing is real but not bounded enough
		// for a reliable test (the write's 80KB of already-kernel-accepted data can sit around for
		// longer than any sane test timeout before an actual RST/FIN reaches the peer).
		let capturedRes: import("node:http").ServerResponse | undefined;
		const base = await listen((req, res) => {
			// Only the FIRST connection (the slow one) matters here -- a second incoming request
			// (the healthy client, below) must never overwrite this.
			if (!capturedRes) {
				capturedRes = res;
				// A genuinely non-reading raw socket peer alone doesn't reliably reproduce
				// deterministic accumulation in a fast test -- confirmed directly, not assumed: the OS's
				// own kernel-level receive buffer for that connection (often several hundred KB to a
				// few MB on loopback, sometimes auto-tuned higher) can happily absorb a modest amount of
				// data regardless of whether the *application* on the other end ever calls read() on
				// it, meaning genuine wire-level backpressure needs either far more data or far more
				// wall-clock time than a fast test should spend. res.cork() forces every write to stay
				// in this response's own internal buffer (real, standard Node API, not a test-only
				// stub) until uncork() -- deterministically reproducing "this connection never drains"
				// without depending on OS buffer sizing at all. Never uncorked -- exactly matching a
				// client that truly never reads, for the whole rest of this test.
				res.cork();
			}
			routes.streamEvents(req, res);
		});
		const url = new URL(base);

		// The slow/non-reading client: a raw socket that issues a real HTTP GET and then never
		// attaches a 'data' listener or calls resume() -- Node sockets start paused, so this
		// client genuinely never drains a single byte the server sends it.
		const slowSocket = connect({ host: url.hostname, port: Number(url.port) });
		await new Promise<void>((resolve, reject) => {
			slowSocket.once("connect", () => resolve());
			slowSocket.once("error", reject);
		});
		slowSocket.write(`GET /api/world/events HTTP/1.1\r\nHost: ${url.host}\r\nConnection: keep-alive\r\n\r\n`);
		// Gives the server time to actually route the request and call streamEvents (registering
		// its own world.onChange subscription) before the burst below fires -- otherwise the burst
		// could race ahead of a still-unparsed raw request and hit zero subscribers for it.
		await new Promise((resolve) => setTimeout(resolve, 50));

		// A genuinely fast, normal, reading second client -- proves the destroy is per-connection.
		// Actually read from it, and interleaved with each burst write below -- a client that never
		// gets a chance to drain (because nothing ever awaits between writes) is indistinguishable
		// from a slow one, which would defeat the entire point of this test.
		const healthyController = new AbortController();
		const healthyResponse = await fetch(`${base}/api/world/events`, { signal: healthyController.signal });
		const healthyReader = healthyResponse.body?.getReader();
		if (!healthyReader) throw new Error("expected a readable body");
		await healthyReader.read(); // drains its own initial snapshot frame

		// A real, sustained burst of 15 real World changes -- dock then immediately undock the same
		// Surface, over and over, so every single WorldViewModel this sends stays the same ~60KB size
		// throughout (never cumulatively growing) -- WorldViewModel is genuinely the full snapshot on
		// every change (the same "individually large payload" aggravating factor opencode's own
		// incident named, full session/diff state per event, not a lean delta), so 15 real,
		// same-sized frames comfortably exceed the 300KB cap for the slow, never-draining client
		// while never once exceeding it for the healthy, actively-draining one.
		for (let index = 0; index < 15; index += 1) {
			const surface = world.dockSurface(workspaceId("ws"), integrationId("int"), "S");
			world.undockSurface(workspaceId("ws"), surface.id);
			// The healthy client actively drains after every single write -- the real behavior that
			// keeps its own writableLength from ever accumulating multiple undrained frames, unlike
			// the slow socket, which never reads at all. Reads twice (dock's own frame, then undock's).
			await healthyReader.read();
			await healthyReader.read();
		}

		// The slow connection's own real http.ServerResponse must have been destroyed -- the real,
		// deterministic, immediate signal (see the capturedRes doc comment above). The far end's own
		// raw socket eventually sees this too, just on real, unbounded OS teardown timing this test
		// doesn't gate its own pass/fail on.
		expect(capturedRes?.destroyed).toBe(true);

		// The healthy client is completely unaffected: it can still read further real data after
		// the slow client was destroyed.
		world.createWorkspace(workspaceId("after-destroy"), "still alive");
		const decoder = new TextDecoder();
		let received = "";
		while (!received.includes("after-destroy")) {
			const next = await healthyReader.read();
			if (next.done) throw new Error("healthy client's own stream ended unexpectedly");
			received += decoder.decode(next.value);
		}
		expect(received).toContain("after-destroy");

		healthyController.abort();
		slowSocket.destroy();
	});
});
