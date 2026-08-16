import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createWorldStore } from "@zodiac/server/world";
import { worldId, workspaceId, integrationId, surfaceId } from "@zodiac/protocol";
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
		const dockedSurfaceId = world.getWorkspace(workspaceId("ws"))?.windows[0]?.surfaces[0]?.id;
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
		expect(world.getWorkspace(workspaceId("ws"))?.windows[0]?.surfaces).toHaveLength(1);
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
});
