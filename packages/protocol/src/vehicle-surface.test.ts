import { describe, expect, it } from "vitest";
import {
	VehicleSurfaceEventSchema,
	VehicleSurfaceInvokeRequestSchema,
	VehicleSurfaceInvokeResultSchema,
	VehicleSurfaceManifestSchema,
} from "./vehicle-surface.js";

const operation = {
	name: "tasks.list",
	version: 1,
	description: "List tasks",
	effect: "read",
	available: true,
	approvalRequired: false,
	permissions: ["tasks:read"],
	limits: { maxRequestBytes: 1024, maxResponseBytes: 4096, defaultTimeoutMs: 1000, maxTimeoutMs: 5000 },
};

describe("Vehicle Surface wire schemas", () => {
	it("bounds renderer-facing manifests", () => {
		expect(VehicleSurfaceManifestSchema.safeParse({ id: "papyrus", title: "Papyrus", vehicle: { name: "papyrus", version: "1", description: "Graph artifacts" }, operations: [operation], events: [{ name: "tasks.changed", version: 1, description: "Task changed", maxPayloadBytes: 4096 }] }).success).toBe(true);
		expect(VehicleSurfaceManifestSchema.safeParse({ id: "papyrus", title: "Papyrus", vehicle: { name: "papyrus", version: "1", description: "x" }, operations: Array.from({ length: 513 }, () => operation), events: [] }).success).toBe(false);
	});

	it("rejects malformed invoke and event envelopes while preserving unknown domain payloads", () => {
		expect(VehicleSurfaceInvokeRequestSchema.safeParse({ name: "tasks.list", version: 1, input: { project_root: "/repo" } }).success).toBe(true);
		expect(VehicleSurfaceInvokeRequestSchema.safeParse({ name: "", version: 0, input: {} }).success).toBe(false);
		expect(VehicleSurfaceInvokeResultSchema.safeParse({ ok: true, output: [{ id: "task-1" }] }).success).toBe(true);
		expect(VehicleSurfaceInvokeResultSchema.safeParse({ ok: false, error: { code: "unavailable", category: "unavailable", message: "down", retryable: true } }).success).toBe(true);
		expect(VehicleSurfaceEventSchema.safeParse({ type: "event", surfaceId: "papyrus", topic: "tasks.changed@1", payload: { id: "task-1" } }).success).toBe(true);
	});
});
