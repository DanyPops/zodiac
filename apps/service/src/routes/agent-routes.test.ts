import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentIntegrationPort, ZodiacAgentEvent } from "@zodiac/agent";
import { workspaceId } from "@zodiac/protocol";
import { createAgentSessionRegistry } from "../agent/agent-session-registry.js";
import { createAgentRoutes } from "./agent-routes.js";

function fakeIntegration(): AgentIntegrationPort & { emit(event: ZodiacAgentEvent): void } {
	const eventListeners = new Set<(event: ZodiacAgentEvent) => void>();
	return {
		prompt: vi.fn(async () => {}),
		steer: vi.fn(async () => {}),
		followUp: vi.fn(async () => {}),
		abort: vi.fn(async () => {}),
		onEvent: (listener) => {
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
		},
		onExit: () => () => {},
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

describe("createAgentRoutes", () => {
	it("createSession returns a fresh sessionId backed by the registry", async () => {
		const registry = createAgentSessionRegistry(() => fakeIntegration());
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.createSession(req, res);
		});

		const response = await fetch(`${base}/api/agent/sessions`, { method: "POST" });
		const body = (await response.json()) as { sessionId: string };
		expect(response.status).toBe(200);
		expect(registry.get(body.sessionId)).toBeDefined();
	});

	it("createSession returns 500 instead of crashing when construction fails (e.g. no model configured)", async () => {
		const registry = createAgentSessionRegistry(() => {
			throw new Error("no model configured");
		});
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.createSession(req, res);
		});

		const response = await fetch(`${base}/api/agent/sessions`, { method: "POST" });
		expect(response.status).toBe(500);
	});

	it("createSession resolves a requested workspaceId through getWorkspaceToolIds, never a client-supplied tool list", async () => {
		const createIntegration = vi.fn(() => fakeIntegration());
		const registry = createAgentSessionRegistry(createIntegration);
		const getWorkspaceToolIds = vi.fn(() => ["lector.fs"]);
		const routes = createAgentRoutes(registry, getWorkspaceToolIds);
		const base = await listen((req, res) => {
			void routes.createSession(req, res);
		});

		await fetch(`${base}/api/agent/sessions`, { method: "POST", body: JSON.stringify({ workspaceId: "ws", tools: ["edit", "write", "bash"] }) });

		expect(getWorkspaceToolIds).toHaveBeenCalledWith(workspaceId("ws"));
		expect(createIntegration).toHaveBeenCalledWith(undefined, ["lector.fs"], workspaceId("ws"));
	});

	it("createSession omits initialActiveToolNames when no workspaceId is requested -- preserves the factory's own default", async () => {
		const createIntegration = vi.fn(() => fakeIntegration());
		const registry = createAgentSessionRegistry(createIntegration);
		const getWorkspaceToolIds = vi.fn(() => ["lector.fs"]);
		const routes = createAgentRoutes(registry, getWorkspaceToolIds);
		const base = await listen((req, res) => {
			void routes.createSession(req, res);
		});

		await fetch(`${base}/api/agent/sessions`, { method: "POST" });

		expect(getWorkspaceToolIds).not.toHaveBeenCalled();
		expect(createIntegration).toHaveBeenCalledWith(undefined, undefined, undefined);
	});

	it("createSession forwards the raw workspaceId to the integration factory even when getWorkspaceToolIds is unavailable -- it's a separate concern from the tool-list resolution", async () => {
		const createIntegration = vi.fn(() => fakeIntegration());
		const registry = createAgentSessionRegistry(createIntegration);
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.createSession(req, res);
		});

		await fetch(`${base}/api/agent/sessions`, { method: "POST", body: JSON.stringify({ workspaceId: "ws" }) });

		expect(createIntegration).toHaveBeenCalledWith(undefined, undefined, workspaceId("ws"));
	});

	it("listSessions reports every live session", async () => {
		const registry = createAgentSessionRegistry(() => fakeIntegration());
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.listSessions(req, res);
		});
		const id = await registry.create();

		const response = await fetch(`${base}/api/agent/sessions`);
		const body = (await response.json()) as { sessions: { sessionId: string }[] };
		expect(response.status).toBe(200);
		expect(body.sessions.map((s) => s.sessionId)).toEqual([id]);
	});

	it("prompt/steer/followUp/abort forward to the right session's integration, and 404 for an unknown one", async () => {
		const integration = fakeIntegration();
		const registry = createAgentSessionRegistry(() => integration);
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.dispatchAction(req, res);
		});
		const id = await registry.create();

		const prompt = await fetch(`${base}/api/agent/sessions/${id}/prompt`, { method: "POST", body: JSON.stringify({ text: "hello" }) });
		expect(prompt.status).toBe(200);
		expect(integration.prompt).toHaveBeenCalledWith("hello");

		const steer = await fetch(`${base}/api/agent/sessions/${id}/steer`, { method: "POST", body: JSON.stringify({ text: "steer text" }) });
		expect(steer.status).toBe(200);
		expect(integration.steer).toHaveBeenCalledWith("steer text");

		const followUp = await fetch(`${base}/api/agent/sessions/${id}/followUp`, { method: "POST", body: JSON.stringify({ text: "follow up" }) });
		expect(followUp.status).toBe(200);
		expect(integration.followUp).toHaveBeenCalledWith("follow up");

		const abort = await fetch(`${base}/api/agent/sessions/${id}/abort`, { method: "POST" });
		expect(abort.status).toBe(200);
		expect(integration.abort).toHaveBeenCalledOnce();

		const unknown = await fetch(`${base}/api/agent/sessions/nope/prompt`, { method: "POST", body: JSON.stringify({ text: "hi" }) });
		expect(unknown.status).toBe(404);
	});

	it("prompt rejects a missing or empty text", async () => {
		const registry = createAgentSessionRegistry(() => fakeIntegration());
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.dispatchAction(req, res);
		});
		const id = await registry.create();

		const missing = await fetch(`${base}/api/agent/sessions/${id}/prompt`, { method: "POST", body: "{}" });
		expect(missing.status).toBe(400);

		const empty = await fetch(`${base}/api/agent/sessions/${id}/prompt`, { method: "POST", body: JSON.stringify({ text: "   " }) });
		expect(empty.status).toBe(400);
	});

	it("streamEvents replays accumulated history to a newly-attaching subscriber, then tails live events", async () => {
		const integration = fakeIntegration();
		const registry = createAgentSessionRegistry(() => integration);
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.streamEvents(req, res);
		});
		const id = await registry.create();

		// Emitted before any subscriber ever connects -- the exact "late
		// joiner" scenario the replay-then-tail requirement exists for.
		integration.emit({ type: "agent-start" });
		integration.emit({ type: "assistant-message-end", text: "hi" });

		const controller = new AbortController();
		const response = await fetch(`${base}/api/agent/sessions/${id}/events`, { signal: controller.signal });
		expect(response.headers.get("content-type")).toContain("text/event-stream");

		const reader = response.body?.getReader();
		if (!reader) throw new Error("expected a readable body");
		const decoder = new TextDecoder();

		let received = "";
		while (!received.includes("assistant-message-end")) {
			const { value, done } = await reader.read();
			if (done) break;
			received += decoder.decode(value);
		}
		expect(received).toContain('data: {"type":"agent-start"}');
		expect(received).toContain('data: {"type":"assistant-message-end","text":"hi"}');

		integration.emit({ type: "agent-settled" });
		while (!received.includes("agent-settled")) {
			const { value, done } = await reader.read();
			if (done) break;
			received += decoder.decode(value);
		}
		expect(received).toContain('data: {"type":"agent-settled"}');

		controller.abort();
	});

	it("streamEvents 404s for an unknown session", async () => {
		const registry = createAgentSessionRegistry(() => fakeIntegration());
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.streamEvents(req, res);
		});

		const response = await fetch(`${base}/api/agent/sessions/nope/events`);
		expect(response.status).toBe(404);
	});
});
