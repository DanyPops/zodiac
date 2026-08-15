import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { TerminalPtyPort } from "../terminal/terminal-pty-port.js";
import { createTerminalSessionRegistry } from "../terminal/terminal-session-registry.js";
import { createTerminalRoutes } from "./terminal-routes.js";

function fakePty(): TerminalPtyPort & { emitData(data: string): void; emitExit(exitCode: number): void } {
	const dataListeners = new Set<(data: string) => void>();
	const exitListeners = new Set<(exitCode: number) => void>();
	return {
		write: vi.fn(),
		resize: vi.fn(),
		kill: vi.fn(),
		onData: (listener) => {
			dataListeners.add(listener);
			return () => dataListeners.delete(listener);
		},
		onExit: (listener) => {
			exitListeners.add(listener);
			return () => exitListeners.delete(listener);
		},
		emitData(data) {
			for (const listener of dataListeners) listener(data);
		},
		emitExit(exitCode) {
			for (const listener of exitListeners) listener(exitCode);
		},
	};
}

let server: Server | undefined;
let wss: WebSocketServer | undefined;

afterEach(() => {
	wss?.close();
	server?.close();
	server = undefined;
	wss = undefined;
});

/** Wires the same generic HTTP request + WS upgrade split server.ts itself uses -- a real bound TCP server, a real `ws` handshake, not a call directly into handleConnection. */
async function listenWithWebSocket(routes: ReturnType<typeof createTerminalRoutes>): Promise<{ httpBase: string; wsBase: string }> {
	server = createServer((req, res) => {
		if (req.method === "POST" && req.url === "/api/terminal/sessions") {
			void routes.createSession(req, res);
			return;
		}
		if (req.method === "GET" && req.url === "/api/terminal/sessions") {
			routes.listSessions(req, res);
			return;
		}
		res.statusCode = 404;
		res.end();
	});
	wss = new WebSocketServer({ noServer: true });
	server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
		const match = /^\/api\/terminal\/sessions\/([^/]+)$/.exec(new URL(req.url ?? "", "http://zodiac.local").pathname);
		const sessionId = match?.[1];
		if (!sessionId) {
			socket.destroy();
			return;
		}
		wss?.handleUpgrade(req, socket, head, (ws) => routes.handleConnection(ws, sessionId));
	});
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
	return { httpBase: `http://127.0.0.1:${address.port}`, wsBase: `ws://127.0.0.1:${address.port}` };
}

/**
 * A persistent listener attached immediately at construction, not a one-shot
 * `.once("message", ...)` registered after the fact -- the server can (and
 * in the replay-then-tail test, does) send its first frame the instant the
 * handshake completes, which can race a caller's own `await waitForOpen()`
 * continuation and be missed entirely by a listener attached too late. This
 * queues every message as it arrives; next() drains the queue first, only
 * waiting on a fresh event once it's empty.
 */
function messageQueue(ws: WebSocket): { next(): Promise<unknown> } {
	const queue: unknown[] = [];
	const waiters: ((value: unknown) => void)[] = [];
	ws.on("message", (raw: Buffer) => {
		const parsed = JSON.parse(raw.toString("utf8"));
		const waiter = waiters.shift();
		if (waiter) waiter(parsed);
		else queue.push(parsed);
	});
	return {
		next(): Promise<unknown> {
			if (queue.length > 0) return Promise.resolve(queue.shift());
			return new Promise((resolve) => waiters.push(resolve));
		},
	};
}

function waitForOpen(ws: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		ws.once("open", () => resolve());
		ws.once("error", reject);
	});
}

describe("createTerminalRoutes", () => {
	it("createSession returns a fresh sessionId backed by the registry", async () => {
		const registry = createTerminalSessionRegistry(() => fakePty());
		const routes = createTerminalRoutes(registry);
		const { httpBase } = await listenWithWebSocket(routes);

		const response = await fetch(`${httpBase}/api/terminal/sessions`, { method: "POST" });
		const body = (await response.json()) as { sessionId: string };
		expect(response.status).toBe(200);
		expect(typeof body.sessionId).toBe("string");
		expect(registry.get(body.sessionId)).toBeDefined();
	});

	it("listSessions reports every live session", async () => {
		const registry = createTerminalSessionRegistry(() => fakePty());
		const routes = createTerminalRoutes(registry);
		const { httpBase } = await listenWithWebSocket(routes);
		const id = registry.create();

		const response = await fetch(`${httpBase}/api/terminal/sessions`);
		const body = (await response.json()) as { sessions: { sessionId: string }[] };
		expect(body.sessions.map((s) => s.sessionId)).toContain(id);
	});

	it("a WebSocket client attaching to an unknown sessionId is closed with a real close code, not left hanging", async () => {
		const registry = createTerminalSessionRegistry(() => fakePty());
		const routes = createTerminalRoutes(registry);
		const { wsBase } = await listenWithWebSocket(routes);

		const client = new WebSocket(`${wsBase}/api/terminal/sessions/nope`);
		const closed = await new Promise<{ code: number }>((resolve) => client.once("close", (code: number) => resolve({ code })));
		expect(closed.code).toBe(4404);
	});

	it("replays buffered history to a newly-attaching client, then tails live output", async () => {
		const pty = fakePty();
		const registry = createTerminalSessionRegistry(() => pty);
		const routes = createTerminalRoutes(registry);
		const { wsBase } = await listenWithWebSocket(routes);
		const id = registry.create();
		pty.emitData("$ echo hi\r\nhi\r\n");

		const client = new WebSocket(`${wsBase}/api/terminal/sessions/${id}`);
		const messages = messageQueue(client);
		await waitForOpen(client);

		const replay = await messages.next();
		expect(replay).toEqual({ type: "output", data: "$ echo hi\r\nhi\r\n" });

		const tailPromise = messages.next();
		pty.emitData("$ ");
		expect(await tailPromise).toEqual({ type: "output", data: "$ " });

		client.close();
	});

	it("a client's {type: input} message writes to the pty; {type: resize} resizes it", async () => {
		const pty = fakePty();
		const registry = createTerminalSessionRegistry(() => pty);
		const routes = createTerminalRoutes(registry);
		const { wsBase } = await listenWithWebSocket(routes);
		const id = registry.create();

		const client = new WebSocket(`${wsBase}/api/terminal/sessions/${id}`);
		await waitForOpen(client);
		client.send(JSON.stringify({ type: "input", data: "ls\n" }));
		client.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(pty.write).toHaveBeenCalledWith("ls\n");
		expect(pty.resize).toHaveBeenCalledWith(120, 40);
		client.close();
	});

	it("two independent WebSocket clients attached to the same sessionId both see the same live output -- the multi-client story, for terminals", async () => {
		const pty = fakePty();
		const registry = createTerminalSessionRegistry(() => pty);
		const routes = createTerminalRoutes(registry);
		const { wsBase } = await listenWithWebSocket(routes);
		const id = registry.create();

		const clientA = new WebSocket(`${wsBase}/api/terminal/sessions/${id}`);
		const clientB = new WebSocket(`${wsBase}/api/terminal/sessions/${id}`);
		const messagesA = messageQueue(clientA);
		const messagesB = messageQueue(clientB);
		await Promise.all([waitForOpen(clientA), waitForOpen(clientB)]);

		const aTail = messagesA.next();
		const bTail = messagesB.next();
		pty.emitData("shared output");
		expect(await aTail).toEqual({ type: "output", data: "shared output" });
		expect(await bTail).toEqual({ type: "output", data: "shared output" });

		clientA.close();
		clientB.close();
	});

	it("a client disconnecting does not kill the pty -- persistence/detachment, not lifetime-bound to one connection", async () => {
		const pty = fakePty();
		const registry = createTerminalSessionRegistry(() => pty);
		const routes = createTerminalRoutes(registry);
		const { wsBase } = await listenWithWebSocket(routes);
		const id = registry.create();

		const client = new WebSocket(`${wsBase}/api/terminal/sessions/${id}`);
		await waitForOpen(client);
		client.close();
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(pty.kill).not.toHaveBeenCalled();
		expect(registry.get(id)).toBeDefined();
	});

	it("the shell exiting on its own is reported to an attached client as {type: exit}", async () => {
		const pty = fakePty();
		const registry = createTerminalSessionRegistry(() => pty);
		const routes = createTerminalRoutes(registry);
		const { wsBase } = await listenWithWebSocket(routes);
		const id = registry.create();

		const client = new WebSocket(`${wsBase}/api/terminal/sessions/${id}`);
		const messages = messageQueue(client);
		await waitForOpen(client);
		const exitPromise = messages.next();
		pty.emitExit(1);
		expect(await exitPromise).toEqual({ type: "exit", exitCode: 1 });

		client.close();
	});
});
