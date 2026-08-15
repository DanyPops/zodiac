import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { worldId } from "@zodiac/protocol";
import { createWorldStore } from "@zodiac/server/world";
import { createZodiacService } from "./server.js";

let dir: string;
let service: Awaited<ReturnType<typeof createZodiacService>> | undefined;

afterEach(async () => {
	await service?.close();
	service = undefined;
	if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("createZodiacService", () => {
	it("listens on an ephemeral loopback port and serves the World, Conversations, and a healthcheck", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1" });

		const health = await fetch(`${service.baseUrl}/healthz`);
		expect(health.status).toBe(200);

		const worldResponse = await fetch(`${service.baseUrl}/api/world`);
		expect(worldResponse.status).toBe(200);

		const conversations = await fetch(`${service.baseUrl}/api/conversations`);
		expect(conversations.status).toBe(200);
	});

	it("404s an unrecognized route instead of hanging or crashing", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1" });

		const response = await fetch(`${service.baseUrl}/api/nonexistent`);
		expect(response.status).toBe(404);
	});

	it("dispatches a real command end to end through the live HTTP surface", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-service-"));
		const world = createWorldStore(worldId("zodiac"));
		service = await createZodiacService({ world, sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1" });

		const response = await fetch(`${service.baseUrl}/api/world/commands`, {
			method: "POST",
			body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "ws", title: "WS" } }),
		});
		expect(response.status).toBe(200);

		const snapshot = await fetch(`${service.baseUrl}/api/world`).then((r) => r.json());
		expect(snapshot).toMatchObject({ state: "ready", workspaces: [{ id: "ws", title: "WS" }] });
	});
});
