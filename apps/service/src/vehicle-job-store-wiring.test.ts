import { bindVehicleOperation, defineVehicleOperation, defineVehicleSchema } from "@danypops/vehicle-core";
import { LocalVehicleClient } from "@danypops/vehicle-client/local";
import { VehicleJobStore } from "@danypops/vehicle-server/jobs";
import { VehicleRegistry } from "@danypops/vehicle-server";
import { describe, expect, it, vi } from "vitest";

const passthroughSchema = defineVehicleSchema<Record<string, unknown>>({
	jsonSchema: { type: "object" },
	safeParse: (value) => ({ success: true, value: (value ?? {}) as Record<string, unknown> }),
});

/**
 * TDD item 1 of the "propose_visual_cue: Grant-governed Job execution" Papyrus Task: proves
 * apps/service/src/cli.ts's own real wiring pattern (VehicleJobStore alongside vehicleRegistry,
 * threaded through LocalVehicleClient's own jobStore option) actually makes
 * submitJob/pollJob/tailJob work -- not visual-cue.propose's own logic, just the daemon's
 * composition-root wiring itself, against a trivial background-capable test operation.
 */
function backgroundCapableOperation() {
	return defineVehicleOperation({
		name: "test.trivial-background-task",
		version: 1,
		description: "A trivial background-capable operation for proving Vehicle Jobs wiring.",
		input: passthroughSchema,
		output: passthroughSchema,
		permissions: [],
		effect: "read",
		idempotency: { mode: "safe" },
		longRunning: true,
		limits: { defaultTimeoutMs: 1_000, maxTimeoutMs: 5_000, maxRequestBytes: 4_096, maxResponseBytes: 4_096 },
		background: { supported: true, defaultWakeBudget: { maxCount: 10, maxBytes: 10_000 }, maxWakeBudget: { maxCount: 10, maxBytes: 10_000 } },
	});
}

describe("apps/service's own real VehicleJobStore + LocalVehicleClient wiring pattern (mirrors cli.ts's main() exactly)", () => {
	it("submitJob -> pollJob genuinely round-trips through a real Vehicle Job, not a bare invoke()", async () => {
		const vehicleRegistry = new VehicleRegistry({ name: "zodiac", version: "1", description: "Test." });
		const operation = backgroundCapableOperation();
		vehicleRegistry.register("test-owner", bindVehicleOperation(operation, () => async (context) => ({ received: context.input })));

		// Exactly cli.ts's own construction order: VehicleJobStore wraps the same registry,
		// then LocalVehicleClient is given it via the jobStore option.
		const vehicleJobStore = new VehicleJobStore(vehicleRegistry);
		const vehicleClient = new LocalVehicleClient(vehicleRegistry, { jobStore: vehicleJobStore });

		expect(vehicleClient.submitJob).toBeDefined();
		expect(vehicleClient.pollJob).toBeDefined();
		expect(vehicleClient.tailJob).toBeDefined();

		const { jobId } = await vehicleClient.submitJob!("test.trivial-background-task", 1, { hello: "world" });
		await vi.waitFor(async () => expect((await vehicleClient.pollJob!(jobId)).status).not.toBe("running"));

		const snapshot = await vehicleClient.pollJob!(jobId);
		expect(snapshot.status).toBe("succeeded");
		expect(snapshot.output).toEqual({ received: { hello: "world" } });
	});

	it("a LocalVehicleClient constructed with no jobStore (the pre-this-task shape) rejects submitJob outright -- confirms the real gap this task closed, not a hypothetical", async () => {
		const vehicleRegistry = new VehicleRegistry({ name: "zodiac", version: "1", description: "Test." });
		const vehicleClient = new LocalVehicleClient(vehicleRegistry);
		await expect(vehicleClient.submitJob!("test.trivial-background-task", 1, {})).rejects.toThrow(/constructed without a VehicleJobStore/);
	});
});
