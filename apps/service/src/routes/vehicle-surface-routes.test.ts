import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentIntegrationPort } from "@zodiac/agent";
import { worldId, type VehicleSurfaceEvent } from "@zodiac/protocol";
import type { VehicleSurfaceGateway } from "@zodiac/server/vehicle";
import { createWorldStore } from "@zodiac/server/world";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createZodiacService } from "../server.js";

function integration(): AgentIntegrationPort {
	return { prompt: async () => {}, steer: async () => {}, followUp: async () => {}, abort: async () => {}, onEvent: () => () => {}, onExit: () => () => {}, dispose: () => {} };
}

const projectedManifest = {
	id: "papyrus",
	title: "Papyrus",
	vehicle: { name: "papyrus", version: "1", description: "Graph artifacts" },
	operations: [{ name: "tasks.list", version: 1, description: "List tasks", effect: "read" as const, available: true, approvalRequired: false, permissions: ["tasks:read"], limits: { defaultTimeoutMs: 1000, maxTimeoutMs: 5000, maxRequestBytes: 1024, maxResponseBytes: 4096 } }],
	events: [],
};

let service: Awaited<ReturnType<typeof createZodiacService>> | undefined;
let dir = "";

afterEach(async () => {
	await service?.close();
	service = undefined;
	if (dir) rmSync(dir, { recursive: true, force: true });
});

async function start(gateway: VehicleSurfaceGateway): Promise<string> {
	dir = mkdtempSync(join(tmpdir(), "zodiac-vehicle-surface-routes-"));
	service = await createZodiacService({ world: createWorldStore(worldId("zodiac")), sessionsRoot: join(dir, "sessions"), port: 0, host: "127.0.0.1", createAgentIntegration: integration, vehicleSurfaces: gateway, allowedOrigins: ["http://127.0.0.1:5173", "http://localhost:5173"] });
	return service.baseUrl;
}

function gateway(): VehicleSurfaceGateway & { invoke: ReturnType<typeof vi.fn>; manifest: ReturnType<typeof vi.fn>; emit: (event: VehicleSurfaceEvent) => void } {
	const manifest = vi.fn(async () => projectedManifest);
	const invoke = vi.fn(async () => ({ ok: true as const, output: [{ id: "task-1" }] }));
	let listener: ((event: VehicleSurfaceEvent) => void) | undefined;
	return {
		list: () => [{ id: "papyrus", title: "Papyrus" }],
		manifest,
		invoke,
		subscribe: async (surfaceId, emit) => {
			listener = emit;
			emit({ type: "state", surfaceId, state: "live" });
			return { close() { listener = undefined; } };
		},
		emit: (event) => listener?.(event),
	};
}

describe("Vehicle Surface routes", () => {
	it("projects manifest and invokes through zodiacd without any bearer token in browser-visible traffic", async () => {
		const fake = gateway();
		const baseUrl = await start(fake);
		const manifestResponse = await fetch(`${baseUrl}/api/vehicle-surfaces/papyrus/manifest`, { headers: { Origin: "http://127.0.0.1:5173" } });
		expect(manifestResponse.status).toBe(200);
		const manifestText = await manifestResponse.text();
		expect(manifestText).not.toMatch(/token|bearer|authorization/i);

		const invokeResponse = await fetch(`${baseUrl}/api/vehicle-surfaces/papyrus/invoke`, {
			method: "POST",
			headers: { Origin: "http://127.0.0.1:5173", "Content-Type": "application/json" },
			body: JSON.stringify({ name: "tasks.list", version: 1, input: { project_root: "/repo" } }),
		});
		expect(await invokeResponse.json()).toEqual({ ok: true, output: [{ id: "task-1" }] });
		expect(fake.invoke).toHaveBeenCalledWith("papyrus", { name: "tasks.list", version: 1, input: { project_root: "/repo" } });
	});

	it("denies an untrusted browser Origin before touching the Vehicle gateway", async () => {
		const fake = gateway();
		const baseUrl = await start(fake);
		const response = await fetch(`${baseUrl}/api/vehicle-surfaces/papyrus/manifest`, { headers: { Origin: "https://evil.example" } });
		expect(response.status).toBe(403);
		expect(fake.manifest).not.toHaveBeenCalled();
	});

	it("streams live invalidations after the GET request itself has completed", async () => {
		const fake = gateway();
		const baseUrl = await start(fake);
		const response = await fetch(`${baseUrl}/api/vehicle-surfaces/papyrus/events`, { headers: { Origin: "http://localhost:5173" } });
		expect(response.status).toBe(200);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("expected SSE body");
		const first = await reader.read();
		expect(new TextDecoder().decode(first.value)).toContain('"state":"live"');
		fake.emit({ type: "event", surfaceId: "papyrus", topic: "tasks", payload: { operation: "tasks.create" } });
		const second = await reader.read();
		await reader.cancel();
		expect(new TextDecoder().decode(second.value)).toContain('"topic":"tasks"');
	});
});
