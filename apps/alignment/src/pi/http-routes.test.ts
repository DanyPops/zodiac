import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPiHttpRoutes } from "./http-routes.js";
import { createPiSessionRegistry } from "./session-registry.js";
import type { PiRpcEvent } from "@danypops/pi-rpc-protocol";
import type { PiRpcSession } from "./process-rpc-session.js";

function fakeSession(): PiRpcSession & { emit(event: PiRpcEvent): void } {
	const eventListeners = new Set<(event: PiRpcEvent) => void>();
	const exitListeners = new Set<(code: number | null) => void>();
	return {
		sendPrompt: vi.fn(),
		abort: vi.fn(),
		stderr: "",
		onEvent: (listener) => {
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
		},
		onExit: (listener) => {
			exitListeners.add(listener);
			return () => exitListeners.delete(listener);
		},
		dispose: vi.fn(),
		emit(event) {
			for (const listener of eventListeners) listener(event);
		},
	};
}

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

describe("createPiHttpRoutes", () => {
	it("createSession returns a fresh sessionId backed by the registry", async () => {
		const registry = createPiSessionRegistry(() => fakeSession());
		const routes = createPiHttpRoutes(registry);
		const base = await listen((req, res) => routes.createSession(req, res));

		const response = await fetch(`${base}/api/pi/sessions`, { method: "POST" });
		const body = (await response.json()) as { sessionId: string };
		expect(response.status).toBe(200);
		expect(registry.get(body.sessionId)).toBeDefined();
	});

	it("sendPrompt rejects a missing sessionId, an unknown sessionId, and an empty message", async () => {
		const registry = createPiSessionRegistry(() => fakeSession());
		const routes = createPiHttpRoutes(registry);
		const base = await listen((req, res) => routes.sendPrompt(req, res));

		const noId = await fetch(`${base}/api/pi/prompt`, { method: "POST", body: JSON.stringify({ message: "hi" }) });
		expect(noId.status).toBe(400);

		const unknown = await fetch(`${base}/api/pi/prompt?sessionId=nope`, { method: "POST", body: JSON.stringify({ message: "hi" }) });
		expect(unknown.status).toBe(404);

		const id = registry.create();
		const empty = await fetch(`${base}/api/pi/prompt?sessionId=${id}`, { method: "POST", body: JSON.stringify({ message: "  " }) });
		expect(empty.status).toBe(400);
	});

	it("sendPrompt forwards a valid message to the session", async () => {
		const session = fakeSession();
		const registry = createPiSessionRegistry(() => session);
		const routes = createPiHttpRoutes(registry);
		const base = await listen((req, res) => routes.sendPrompt(req, res));
		const id = registry.create();

		const response = await fetch(`${base}/api/pi/prompt?sessionId=${id}`, { method: "POST", body: JSON.stringify({ message: "hello" }) });
		expect(response.status).toBe(200);
		expect(session.sendPrompt).toHaveBeenCalledWith("hello");
	});

	it("abort forwards to the session, and 404s for an unknown session", async () => {
		const session = fakeSession();
		const registry = createPiSessionRegistry(() => session);
		const routes = createPiHttpRoutes(registry);
		const base = await listen((req, res) => routes.abort(req, res));
		const id = registry.create();

		const unknown = await fetch(`${base}/api/pi/abort?sessionId=nope`, { method: "POST" });
		expect(unknown.status).toBe(404);

		const ok = await fetch(`${base}/api/pi/abort?sessionId=${id}`, { method: "POST" });
		expect(ok.status).toBe(200);
		expect(session.abort).toHaveBeenCalledOnce();
	});

	it("streamEvents relays session events as SSE data frames, in order", async () => {
		const session = fakeSession();
		const registry = createPiSessionRegistry(() => session);
		const routes = createPiHttpRoutes(registry);
		const base = await listen((req, res) => routes.streamEvents(req, res));
		const id = registry.create();

		const controller = new AbortController();
		const response = await fetch(`${base}/api/pi/events?sessionId=${id}`, { signal: controller.signal });
		expect(response.headers.get("content-type")).toContain("text/event-stream");

		const reader = response.body?.getReader();
		if (!reader) throw new Error("expected a readable body");
		const decoder = new TextDecoder();

		session.emit({ type: "agent_start" });
		session.emit({ type: "agent_settled" });

		let received = "";
		while (!received.includes("agent_settled")) {
			const { value, done } = await reader.read();
			if (done) break;
			received += decoder.decode(value);
		}
		expect(received).toContain('data: {"type":"agent_start"}');
		expect(received).toContain('data: {"type":"agent_settled"}');

		controller.abort();
	});

	it("streamEvents flushes response headers immediately, before any event has fired", async () => {
		const registry = createPiSessionRegistry(() => fakeSession());
		const routes = createPiHttpRoutes(registry);
		const base = await listen((req, res) => routes.streamEvents(req, res));
		const id = registry.create();

		const controller = new AbortController();
		const response = await Promise.race([
			fetch(`${base}/api/pi/events?sessionId=${id}`, { signal: controller.signal }),
			new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("headers never arrived")), 1000)),
		]);
		expect(response.status).toBe(200);
		controller.abort();
	});

	it("streamEvents 404s for an unknown session", async () => {
		const registry = createPiSessionRegistry(() => fakeSession());
		const routes = createPiHttpRoutes(registry);
		const base = await listen((req, res) => routes.streamEvents(req, res));

		const response = await fetch(`${base}/api/pi/events?sessionId=nope`);
		expect(response.status).toBe(404);
	});
});
