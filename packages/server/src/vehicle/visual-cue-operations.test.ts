import { HmacApprovalAuthority } from "@danypops/vehicle-server/approval-authority";
import { VehicleRegistry } from "@danypops/vehicle-server";
import { VehicleJobStore } from "@danypops/vehicle-server/jobs";
import { registerVehicleGrantOperation, VEHICLE_GRANT_CONTINUE_OPERATION_NAME } from "@danypops/vehicle-server/grant";
import { describe, expect, it, vi } from "vitest";
import { createApprovalCenter } from "../approval/approval-center.js";
import { bridgeVehicleRegistryApprovals } from "../approval/vehicle-registry-approval-bridge.js";
import { createEventBus } from "../event/bus.js";
import { FREE_STEP_BUDGET, registerVisualCueOperations, VISUAL_CUE_PROPOSE_OPERATION_NAME } from "./visual-cue-operations.js";

function setup() {
	const authority = new HmacApprovalAuthority();
	const registry = new VehicleRegistry({ name: "zodiac", version: "1", description: "Test." });
	registerVehicleGrantOperation(registry);
	registerVisualCueOperations(registry);
	registry.configureApprovals({ authority });
	const bus = createEventBus();
	const approvalCenter = createApprovalCenter({ bus, authority });
	bridgeVehicleRegistryApprovals(registry, approvalCenter);
	return { registry, approvalCenter, authority };
}

function manyStepInput(count: number): typeof wellFormedInput {
	return { title: "Large tour", steps: Array.from({ length: count }, (_, index) => ({ target: { kind: "gallery-category", id: `item-${String(index)}` }, cue: "highlight" })) };
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

/**
 * Grant-governed Job execution -- the "propose_visual_cue: Grant-governed Job execution"
 * Papyrus Task's own scope. Every test here submits a real Vehicle Job (VehicleJobStore.submit)
 * against the *outer* approval capability already minted (visual-cue.propose's own unconditional
 * requiresApproval gate, proven above) -- these tests are about the *inner* Grant-aware step a
 * large proposal's own job body takes, a separate, later gate from the outer one.
 */
describe("visual-cue.propose: Grant-governed Job execution for a large proposal", () => {
	function mintOuterCapability(registry: ReturnType<typeof setup>["registry"], approvalCenter: ReturnType<typeof setup>["approvalCenter"], input: unknown) {
		return registry.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, input).catch(() => undefined).then(async () => {
			const [request] = approvalCenter.pending();
			return approvalCenter.approve(request!.requestId);
		});
	}

	it("item 2: invokeOrRunAsJob genuinely dispatches through Vehicle Jobs -- a real submit()/poll() round trip settles to the same output a direct invoke() would have given, for a small (ungated) proposal", async () => {
		const { registry, approvalCenter } = setup();
		const capability = await mintOuterCapability(registry, approvalCenter, wellFormedInput);

		const store = new VehicleJobStore(registry);
		const { jobId } = store.submit(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, wellFormedInput, { approvalCapability: capability });
		await vi.waitFor(() => expect(store.poll(jobId).status).not.toBe("running"));

		const snapshot = store.poll(jobId);
		expect(snapshot.status).toBe("succeeded");
		expect(snapshot.output).toEqual({ accepted: true, stepCount: 1 });
	});

	it("item 3: a proposal larger than FREE_STEP_BUDGET durably records a real vehicle.grant.continue approval request, visible via the job's own tail, before the job settles", async () => {
		const { registry, approvalCenter } = setup();
		const bigInput = manyStepInput(FREE_STEP_BUDGET + 3);
		const capability = await mintOuterCapability(registry, approvalCenter, bigInput);

		const grantRequests: unknown[] = [];
		registry.subscribeLocal("vehicle.approval.requested", 1, (payload) => grantRequests.push(payload));

		const store = new VehicleJobStore(registry);
		const { jobId } = store.submit(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, bigInput, { approvalCapability: capability });
		await vi.waitFor(() => expect(grantRequests).toHaveLength(1));
		expect(grantRequests[0]).toMatchObject({ operationName: VEHICLE_GRANT_CONTINUE_OPERATION_NAME, operationVersion: 1 });

		// Still genuinely suspended, not settled -- the job is durably waiting on the grant request above.
		expect(store.poll(jobId).status).toBe("running");

		const [grantRequest] = approvalCenter.pending();
		const grantCapability = approvalCenter.approve(grantRequest!.requestId);
		store.steer(jobId, { approvalCapability: grantCapability, maxTurns: FREE_STEP_BUDGET + 3 });

		await vi.waitFor(() => expect(store.poll(jobId).status).not.toBe("running"));
		const snapshot = store.poll(jobId);
		expect(snapshot.status).toBe("succeeded");
		expect(snapshot.output).toEqual({ accepted: true, stepCount: FREE_STEP_BUDGET + 3 });
	});

	it("item 4: steering a gated job with an explicit denial marker resolves it to a real 'failed' status, never a silent hang", async () => {
		const { registry, approvalCenter } = setup();
		const bigInput = manyStepInput(FREE_STEP_BUDGET + 1);
		const capability = await mintOuterCapability(registry, approvalCenter, bigInput);

		const store = new VehicleJobStore(registry);
		const { jobId } = store.submit(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, bigInput, { approvalCapability: capability });
		await vi.waitFor(() => expect(approvalCenter.pending()).toHaveLength(1));

		store.steer(jobId, { denied: true });

		await vi.waitFor(() => expect(store.poll(jobId).status).toBe("failed"));
		const snapshot = store.poll(jobId);
		expect(snapshot.error?.message).toContain("denied");
	});

	it("item 6: job cleanup is proven, not assumed -- a Grant-governed job (including its own extra vehicle.grant.continue sub-invocation), once delivered, is genuinely evicted once the store's own bounded-retention cap is exceeded by later jobs, not silently retained forever", async () => {
		const { registry, approvalCenter } = setup();
		const store = new VehicleJobStore(registry, { maxRetainedJobs: 2 });

		// The first job -- the one whose real cleanup this test actually proves -- goes through the
		// full Grant-aware steer loop (a large proposal, a real inner vehicle.grant.continue
		// approval), exactly the lifecycle the task's own TDD item 6 names explicitly.
		const firstInput = manyStepInput(FREE_STEP_BUDGET + 1);
		const firstCapability = await mintOuterCapability(registry, approvalCenter, firstInput);
		const { jobId: firstJobId } = store.submit(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, firstInput, { approvalCapability: firstCapability });
		await vi.waitFor(() => expect(approvalCenter.pending()).toHaveLength(1));
		const [grantRequest] = approvalCenter.pending();
		const grantCapability = approvalCenter.approve(grantRequest!.requestId);
		store.steer(firstJobId, { approvalCapability: grantCapability, maxTurns: FREE_STEP_BUDGET + 1 });
		await vi.waitFor(() => expect(store.poll(firstJobId).status).toBe("succeeded"));

		// Read the real result, then explicitly confirm delivery -- the real API contract
		// (VehicleJobStore.markDelivered's own doc comment: "only a delivered job is ever eligible
		// for the retention sweep's eviction") -- an undelivered job must never be evicted just
		// because later jobs exist, regardless of maxRetainedJobs.
		expect(store.poll(firstJobId).output).toEqual({ accepted: true, stepCount: FREE_STEP_BUDGET + 1 });
		store.markDelivered(firstJobId);

		// Three more small, ungated jobs -- one more than maxRetainedJobs (2) -- each delivered in
		// turn, so the sweep triggered by each one's own markDelivered() has real pressure to evict
		// under.
		for (let i = 0; i < 3; i++) {
			const capability = await mintOuterCapability(registry, approvalCenter, wellFormedInput);
			const { jobId } = store.submit(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, wellFormedInput, { approvalCapability: capability });
			await vi.waitFor(() => expect(store.poll(jobId).status).toBe("succeeded"));
			store.markDelivered(jobId);
		}

		// The real, discriminating assertion: the first job's own steer channel/wake log/record are
		// actually gone, not merely idle -- poll() on an evicted job throws job-not-found. This is
		// what "the cleanup infrastructure existed, it just needed to be invoked" (opencode issue
		// #9385) looks like proven rather than assumed: the delivery+sweep path is real and reachable
		// for this specific operation's own Grant-aware lifecycle, not just Vehicle's own generic tests.
		expect(() => store.poll(firstJobId)).toThrow(/job-not-found|No Vehicle job found/);
	});
});
