import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { worldId } from "@zodiac/protocol";
import { createWorldStore } from "@zodiac/server/world";
import type { AgentIntegrationPort, ZodiacAgentEvent } from "@zodiac/agent";
import { createZodiacService } from "./server.js";

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

	it("sends permissive CORS headers on every response and answers an OPTIONS preflight -- a browser-served static build is necessarily a different origin than the daemon", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: fakeIntegration });

		const preflight = await fetch(`${service.baseUrl}/api/world/commands`, {
			method: "OPTIONS",
			headers: { Origin: "http://127.0.0.1:5199", "Access-Control-Request-Method": "POST" },
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5199");
		expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");

		const real = await fetch(`${service.baseUrl}/api/world`, { headers: { Origin: "http://127.0.0.1:5199" } });
		expect(real.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5199");
	});

	it("404s an unrecognized route instead of hanging or crashing", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: fakeIntegration });

		const response = await fetch(`${service.baseUrl}/api/nonexistent`);
		expect(response.status).toBe(404);
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
