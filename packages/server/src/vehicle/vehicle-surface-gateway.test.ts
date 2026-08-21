import type { VehicleManifest } from "@danypops/vehicle-core";
import { VehicleError } from "@danypops/vehicle-core";
import { describe, expect, it, vi } from "vitest";
import { createVehicleSurfaceGateway } from "./vehicle-surface-gateway.js";

const manifest: VehicleManifest = {
	name: "papyrus",
	version: "1",
	description: "Graph artifacts",
	operations: [{
		name: "tasks.list", version: 1, description: "List tasks", inputSchema: {}, outputSchema: {}, permissions: ["tasks:read"], effect: "read",
		idempotency: { mode: "safe" }, streaming: false, longRunning: false,
		limits: { defaultTimeoutMs: 1_000, maxTimeoutMs: 5_000, maxRequestBytes: 1_024, maxResponseBytes: 4_096 }, errors: [], available: true, approvalRequired: false,
	}],
	events: [{ name: "tasks.changed", version: 1, description: "Task changed", payloadSchema: {}, maxPayloadBytes: 4_096 }],
};

interface TestPushOptions {
	readonly topics: readonly string[];
	readonly onMessage: (topic: string, payload: unknown) => void;
	readonly onStateChange?: (state: "connecting" | "open" | "degraded" | "closed") => void;
}

function fixture(options: { invoke?: () => Promise<unknown>; onPush?: (options: TestPushOptions) => { close(): void } } = {}) {
	const invoke = vi.fn(options.invoke ?? (async () => [{ id: "task-1" }]));
	const close = vi.fn(async () => {});
	const gateway = createVehicleSurfaceGateway({
		definitions: [{ id: "papyrus", title: "Papyrus", vehicleName: "papyrus" }],
		resolveTarget: async () => ({ baseUrl: "http://127.0.0.1:4321", pushUrl: "ws://127.0.0.1:4321/push", token: "server-secret" }),
		createClient: () => ({ manifest: async () => manifest, invoke, close }),
		connectPush: options.onPush ?? (() => ({ close: vi.fn() })),
	});
	return { gateway, invoke, close };
}

describe("VehicleSurfaceGateway", () => {
	it("projects a bounded renderer manifest without exposing target URLs or bearer tokens", async () => {
		const { gateway, close } = fixture();
		const projected = await gateway.manifest("papyrus");
		expect(projected.operations.map((operation) => operation.name)).toEqual(["tasks.list"]);
		expect(projected.events.map((event) => event.name)).toEqual(["tasks.changed"]);
		expect(JSON.stringify(projected)).not.toContain("server-secret");
		expect(JSON.stringify(projected)).not.toContain("4321");
		expect(close).toHaveBeenCalledOnce();
	});

	it("invokes only a currently declared operation with manifest permissions and maps Vehicle failures", async () => {
		const { gateway, invoke } = fixture();
		expect(await gateway.invoke("papyrus", { name: "tasks.list", version: 1, input: { project_root: "/repo" } })).toEqual({ ok: true, output: [{ id: "task-1" }] });
		expect(invoke).toHaveBeenCalledWith("tasks.list", 1, { project_root: "/repo" }, expect.objectContaining({ permissions: ["tasks:read"], principal: { id: "zodiac-vehicle-surface:papyrus" } }));
		expect(await gateway.invoke("papyrus", { name: "tasks.missing", version: 1, input: {} })).toMatchObject({ ok: false, error: { code: "operation-not-found", category: "not_found" } });

		const denied = fixture({ invoke: async () => { throw new VehicleError("permission-denied", "Denied", { category: "authorization", retryable: false }); } });
		expect(await denied.gateway.invoke("papyrus", { name: "tasks.list", version: 1, input: {} })).toEqual({ ok: false, error: { code: "permission-denied", category: "authorization", message: "Denied", retryable: false } });
	});

	it("subscribes once to every declared event and forwards reconnect state without exposing the token", async () => {
		let pushOptions: TestPushOptions | undefined;
		const close = vi.fn();
		const { gateway } = fixture({ onPush: (options) => { pushOptions = options; return { close }; } });
		const events: unknown[] = [];
		const subscription = await gateway.subscribe("papyrus", (event) => events.push(event));
		expect(pushOptions?.topics).toEqual(["vehicle-event:tasks.changed@1"]);
		pushOptions?.onStateChange?.("open");
		pushOptions?.onMessage("vehicle-event:tasks.changed@1", { id: "task-1" });
		expect(events).toEqual([
			{ type: "state", surfaceId: "papyrus", state: "connecting" },
			{ type: "state", surfaceId: "papyrus", state: "live" },
			{ type: "event", surfaceId: "papyrus", topic: "vehicle-event:tasks.changed@1", payload: { id: "task-1" } },
		]);
		expect(JSON.stringify(events)).not.toContain("server-secret");
		subscription.close();
		expect(close).toHaveBeenCalledOnce();
	});
});
