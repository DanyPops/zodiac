import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { worldId } from "@zodiac/protocol";
import { createWorldStore } from "@zodiac/server/world";
import type { AgentIntegrationPort, ZodiacAgentEvent } from "@zodiac/agent";
import type { TerminalPtyPort } from "./terminal/terminal-pty-port.js";
import { createZodiacService } from "./server.js";

function fakePty(): TerminalPtyPort & { emitData(data: string): void } {
	const dataListeners = new Set<(data: string) => void>();
	return {
		write: vi.fn(),
		resize: vi.fn(),
		kill: vi.fn(),
		onData: (listener) => {
			dataListeners.add(listener);
			return () => dataListeners.delete(listener);
		},
		onExit: () => () => {},
		emitData(data) {
			for (const listener of dataListeners) listener(data);
		},
	};
}

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

let dir: string;
let service: Awaited<ReturnType<typeof createZodiacService>> | undefined;

afterEach(async () => {
	await service?.close();
	service = undefined;
	if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("createZodiacService", () => {
	it("listens on an ephemeral loopback port and serves the World, Conversations, Agent sessions, and a healthcheck", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: fakeIntegration });

		const health = await fetch(`${service.baseUrl}/healthz`);
		expect(health.status).toBe(200);

		const worldResponse = await fetch(`${service.baseUrl}/api/world`);
		expect(worldResponse.status).toBe(200);

		const conversations = await fetch(`${service.baseUrl}/api/conversations`);
		expect(conversations.status).toBe(200);

		const agentSessions = await fetch(`${service.baseUrl}/api/agent/sessions`);
		expect(agentSessions.status).toBe(200);
	});

	it("sends CORS headers for an explicitly allowed Origin and answers its OPTIONS preflight", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: fakeIntegration, allowedOrigins: ["http://127.0.0.1:5199"] });

		const preflight = await fetch(`${service.baseUrl}/api/world/commands`, {
			method: "OPTIONS",
			headers: { Origin: "http://127.0.0.1:5199", "Access-Control-Request-Method": "POST" },
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5199");
		expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");

		const real = await fetch(`${service.baseUrl}/api/world`, { headers: { Origin: "http://127.0.0.1:5199" } });
		expect(real.status).toBe(200);
		expect(real.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5199");
	});

	it("refuses a request from an Origin outside the allowlist -- default-deny, never reflected", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: fakeIntegration, allowedOrigins: ["http://127.0.0.1:5199"] });

		const response = await fetch(`${service.baseUrl}/api/world`, { headers: { Origin: "https://evil.example" } });
		expect(response.status).toBe(403);
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("refuses every browser Origin when no allowlist is configured", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: fakeIntegration });

		const response = await fetch(`${service.baseUrl}/api/world`, { headers: { Origin: "http://127.0.0.1:5173" } });
		expect(response.status).toBe(403);
	});

	it("still serves a request that sent no Origin header at all, with no allowlist configured -- every real non-browser client", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: fakeIntegration });

		const response = await fetch(`${service.baseUrl}/api/world`);
		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("404s an unrecognized route instead of hanging or crashing", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: fakeIntegration });

		const response = await fetch(`${service.baseUrl}/api/nonexistent`);
		expect(response.status).toBe(404);
	});

	it("terminal routes are 404/refused by default -- real RCE exposure once reachable off loopback, opt-in only", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: fakeIntegration });

		const created = await fetch(`${service.baseUrl}/api/terminal/sessions`, { method: "POST" });
		expect(created.status).toBe(404);

		const wsUrl = service.baseUrl.replace("http://", "ws://");
		const client = new WebSocket(`${wsUrl}/api/terminal/sessions/anything`);
		const outcome = await new Promise<"error" | "open">((resolve) => {
			client.once("error", () => resolve("error"));
			client.once("open", () => resolve("open"));
		});
		expect(outcome).toBe("error");
	});

	it("terminal routes are live when enableTerminal is on: spawn a session over HTTP, then read/write it over the WebSocket", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		const pty = fakePty();
		service = await createZodiacService({
			world,
			sessionsRoot: join(dir, "sessions"),
			port: 0,
			host: "127.0.0.1",
			createAgentIntegration: fakeIntegration,
			enableTerminal: true,
			createTerminalPty: () => pty,
		});

		const created = await fetch(`${service.baseUrl}/api/terminal/sessions`, { method: "POST" });
		expect(created.status).toBe(200);
		const { sessionId } = (await created.json()) as { sessionId: string };

		const wsUrl = service.baseUrl.replace("http://", "ws://");
		const client = new WebSocket(`${wsUrl}/api/terminal/sessions/${sessionId}`);
		const message = await new Promise<unknown>((resolve, reject) => {
			client.once("open", () => pty.emitData("hello from the shell"));
			client.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString("utf8"))));
			client.once("error", reject);
		});
		expect(message).toEqual({ type: "output", data: "hello from the shell" });

		client.send(JSON.stringify({ type: "input", data: "ls\n" }));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(pty.write).toHaveBeenCalledWith("ls\n");

		client.close();
	});

	it("refuses a terminal WebSocket upgrade carrying an Origin outside the allowlist, before ever reaching the session", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		const pty = fakePty();
		service = await createZodiacService({
			world,
			sessionsRoot: join(dir, "sessions"),
			port: 0,
			host: "127.0.0.1",
			createAgentIntegration: fakeIntegration,
			enableTerminal: true,
			createTerminalPty: () => pty,
			allowedOrigins: ["http://127.0.0.1:5199"],
		});

		const created = await fetch(`${service.baseUrl}/api/terminal/sessions`, { method: "POST" });
		const { sessionId } = (await created.json()) as { sessionId: string };

		const wsUrl = service.baseUrl.replace("http://", "ws://");
		const client = new WebSocket(`${wsUrl}/api/terminal/sessions/${sessionId}`, { origin: "https://evil.example" });
		const outcome = await new Promise<"error" | "open">((resolve) => {
			client.once("error", () => resolve("error"));
			client.once("open", () => resolve("open"));
		});
		expect(outcome).toBe("error");
	});

	it("tools route is 404 by default, live when getWorkspaceToolIds is provided", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: fakeIntegration });

		const missing = await fetch(`${service.baseUrl}/api/world/workspaces/ws-1/tools`);
		expect(missing.status).toBe(404);

		await service.close();
		service = await createZodiacService({
			world,
			sessionsRoot: join(dir, "sessions"),
			port: 0,
			host: "127.0.0.1",
			createAgentIntegration: fakeIntegration,
			getWorkspaceToolIds: (id) => (id === "ws-1" ? ["lector.fs"] : []),
		});
		const live = await fetch(`${service.baseUrl}/api/world/workspaces/ws-1/tools`);
		expect(live.status).toBe(200);
		expect(await live.json()).toEqual({ toolIds: ["lector.fs"] });
	});

	it("dispatches a real command end to end through the live HTTP surface", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: fakeIntegration });

		const response = await fetch(`${service.baseUrl}/api/world/commands`, {
			method: "POST",
			body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "ws", title: "WS" } }),
		});
		expect(response.status).toBe(200);

		const snapshot = await fetch(`${service.baseUrl}/api/world`).then((r) => r.json());
		expect(snapshot).toMatchObject({ state: "ready", workspaces: [{ id: "ws", title: "WS" }] });
	});

	it("creates, prompts, and streams a real agent session end to end through the live HTTP surface", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		const integration = fakeIntegration();
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: () => integration });

		const created = await fetch(`${service.baseUrl}/api/agent/sessions`, { method: "POST" });
		const { sessionId } = (await created.json()) as { sessionId: string };

		const listed = await fetch(`${service.baseUrl}/api/agent/sessions`).then((r) => r.json());
		expect(listed).toMatchObject({ sessions: [{ sessionId }] });

		const prompted = await fetch(`${service.baseUrl}/api/agent/sessions/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ text: "hello" }) });
		expect(prompted.status).toBe(200);
		expect(integration.prompt).toHaveBeenCalledWith("hello");

		const controller = new AbortController();
		const events = await fetch(`${service.baseUrl}/api/agent/sessions/${sessionId}/events`, { signal: controller.signal });
		expect(events.headers.get("content-type")).toContain("text/event-stream");
		controller.abort();
	});
});
