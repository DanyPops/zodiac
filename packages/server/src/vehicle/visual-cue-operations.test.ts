import { HmacApprovalAuthority } from "@danypops/vehicle-server/approval-authority";
import { VehicleRegistry } from "@danypops/vehicle-server";
import { describe, expect, it } from "vitest";
import { createApprovalCenter } from "../approval/approval-center.js";
import { bridgeVehicleRegistryApprovals } from "../approval/vehicle-registry-approval-bridge.js";
import { createEventBus } from "../event/bus.js";
import { registerVisualCueOperations, VISUAL_CUE_PROPOSE_OPERATION_NAME } from "./visual-cue-operations.js";

function setup() {
	const authority = new HmacApprovalAuthority();
	const registry = new VehicleRegistry({ name: "zodiac", version: "1", description: "Test." });
	registerVisualCueOperations(registry);
	registry.configureApprovals({ authority });
	const bus = createEventBus();
	const approvalCenter = createApprovalCenter({ bus, authority });
	bridgeVehicleRegistryApprovals(registry, approvalCenter);
	return { registry, approvalCenter, authority };
}

const wellFormedInput = { title: "Meet your first Integration", steps: [{ target: { kind: "gallery-category", id: "lector" }, cue: "highlight" }] };

describe("registerVisualCueOperations", () => {
	it("item 1: invoking visual-cue.propose without a capability durably emits a real VehicleApprovalRequest on the registry's own event stream -- unconditionally gated, not effect-computed from steps", async () => {
		const { registry } = setup();
		const requests: unknown[] = [];
		registry.subscribeLocal("vehicle.approval.requested", 1, (payload) => requests.push(payload));

		await expect(registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, wellFormedInput)).rejects.toThrow(/requires approval/);

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({ operationName: VISUAL_CUE_PROPOSE_OPERATION_NAME, operationVersion: 1 });
	});

	it("item 1b: an all-cosmetic sequence is gated exactly the same as one containing a real command step -- gating is unconditional, not content-dependent (this task's own corrected design)", async () => {
		const { registry } = setup();
		const cosmeticOnly = { title: "Say hi", steps: [{ target: { kind: "panel", id: "workspace-nav" }, cue: "pulse" }] };
		const withRealCommand = { title: "Resize the nav pillar", steps: [{ target: { kind: "panel", id: "workspace-nav" }, cue: "expand" }] };

		await expect(registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, cosmeticOnly)).rejects.toThrow(/requires approval/);
		await expect(registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, withRealCommand)).rejects.toThrow(/requires approval/);
	});

	it("item 2: the CQRS bridge -- the same request, forwarded through the one subscription, appears in approvalCenter.pending() with zero changes needed to NotificationsPill's own read path", async () => {
		const { registry, approvalCenter } = setup();

		await expect(registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, wellFormedInput)).rejects.toThrow();

		const pending = approvalCenter.pending();
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({ operationName: VISUAL_CUE_PROPOSE_OPERATION_NAME, operationVersion: 1 });
	});

	it("item 3: approvalCenter.approve() mints a capability (shared authority) that verifies correctly when presented back to the registry's own enforceGate on a retried invoke -- proving the shared-authority design works end to end, not just in principle", async () => {
		const { registry, approvalCenter } = setup();

		await expect(registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, wellFormedInput)).rejects.toThrow();
		const [request] = approvalCenter.pending();
		const capability = approvalCenter.approve(request!.requestId);
		expect(capability).toBeDefined();

		const output = await registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, wellFormedInput, { approvalCapability: capability });
		expect(output).toEqual({ accepted: true, stepCount: 1 });
		expect(approvalCenter.pending()).toEqual([]); // resolved, not still pending
	});

	it("item 3b: a capability minted for one input is rejected against a different input -- the confused-deputy guard survives all the way through the registry's own enforceGate, not just the bare authority", async () => {
		const { registry, approvalCenter } = setup();

		await expect(registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, wellFormedInput)).rejects.toThrow();
		const [request] = approvalCenter.pending();
		const capability = approvalCenter.approve(request!.requestId);

		const differentInput = { title: "A different proposal entirely", steps: wellFormedInput.steps };
		await expect(registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, differentInput, { approvalCapability: capability })).rejects.toThrow(/rejected the presented approval capability/);
	});

	it("denying means the retried invoke never succeeds, and the real handler never runs", async () => {
		const { registry, approvalCenter } = setup();
		await expect(registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, wellFormedInput)).rejects.toThrow();
		const [request] = approvalCenter.pending();
		approvalCenter.deny(request!.requestId);

		await expect(registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, wellFormedInput)).rejects.toThrow(/requires approval/);
	});

	it("rejects a structurally invalid input (missing title, empty steps) before ever reaching the approval gate", async () => {
		const { registry } = setup();
		await expect(registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, { steps: [] })).rejects.toThrow();
		await expect(registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, { title: "No steps at all", steps: [] })).rejects.toThrow();
	});
});
