import { hashApprovalInput, HmacApprovalAuthority } from "@danypops/vehicle-server/approval-authority";
import type { VehicleApprovalOutcome, VehicleApprovalRequest } from "@danypops/vehicle-core";
import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "../event/bus.js";
import type { BusMessage } from "../event/bus.js";
import { createApprovalCenter } from "./approval-center.js";

/**
 * Papyrus task 263ee9c4-77fa-4514-bbf9-89b6cc3a492c's own TDD plan, plus the concrete
 * confused-deputy scenario from Doc 268443b0 ("Concrete scenario: the confused-deputy attack
 * VehicleApprovalAuthority's exact-scoping prevents") named explicitly rather than as a synthetic
 * input-mismatch case.
 */

function makeRequest(overrides: Partial<VehicleApprovalRequest> = {}): VehicleApprovalRequest {
	return {
		requestId: "REQ-1",
		operationName: "issue.create",
		operationVersion: 1,
		effect: "external-write",
		// Real Date.now()-relative by default (not a fixed small number) -- most tests here don't
		// inject a fake `now`, so ApprovalCenter's own default expiry check runs against the real
		// wall clock; a fixed 1_000/301_000 timestamp would already read as "expired" against it.
		requestedAt: Date.now(),
		expiresAt: Date.now() + 5 * 60_000,
		inputHash: hashApprovalInput({ repo: "acme/widgets", title: "Fix login bug", body: "Users can't log in after..." }),
		...overrides,
	};
}

describe("createApprovalCenter", () => {
	it("request() records the request as pending and publishes it on the notification channel", () => {
		const bus = createEventBus();
		const received: BusMessage[] = [];
		bus.subscribe("notification", "vehicle.approval.requested", (message) => received.push(message));
		const center = createApprovalCenter({ bus });
		const request = makeRequest();

		center.request(request);

		expect(center.pending()).toEqual([request]);
		expect(received).toHaveLength(1);
		expect(received[0]?.payload).toEqual(request);
	});

	it("re-requesting the same requestId (a redelivered event) replaces it in pending() rather than duplicating it", () => {
		const bus = createEventBus();
		const center = createApprovalCenter({ bus });
		center.request(makeRequest());
		const laterExpiry = Date.now() + 10 * 60_000;
		center.request(makeRequest({ expiresAt: laterExpiry }));

		expect(center.pending()).toHaveLength(1);
		expect(center.pending()[0]?.expiresAt).toBe(laterExpiry);
	});

	it("approve() mints a capability via the real HmacApprovalAuthority, publishes a granted outcome, and removes the request from pending", () => {
		const bus = createEventBus();
		const outcomes: VehicleApprovalOutcome[] = [];
		bus.subscribe("notification", "vehicle.approval.resolved", (message) => outcomes.push(message.payload as VehicleApprovalOutcome));
		const center = createApprovalCenter({ bus, authority: new HmacApprovalAuthority() });
		const request = makeRequest();
		center.request(request);

		const capability = center.approve(request.requestId, "alice");

		expect(typeof capability).toBe("string");
		expect(center.pending()).toEqual([]);
		expect(outcomes).toEqual([{ requestId: request.requestId, decision: "granted", decidedAt: expect.any(Number), decidedBy: "alice" }]);
	});

	it("a minted capability verifies against the exact operation+input it was approved for", () => {
		const bus = createEventBus();
		const center = createApprovalCenter({ bus, authority: new HmacApprovalAuthority() });
		const approvedInput = { repo: "acme/widgets", title: "Fix login bug", body: "Users can't log in after..." };
		const request = makeRequest({ inputHash: hashApprovalInput(approvedInput) });
		center.request(request);

		const capability = center.approve(request.requestId)!;

		expect(center.verifyCapability(capability, "issue.create", 1, approvedInput)).toBe(true);
	});

	it("deny() publishes a denied outcome without ever minting a capability, and removes the request from pending", () => {
		const bus = createEventBus();
		const outcomes: VehicleApprovalOutcome[] = [];
		bus.subscribe("notification", "vehicle.approval.resolved", (message) => outcomes.push(message.payload as VehicleApprovalOutcome));
		const center = createApprovalCenter({ bus });
		const request = makeRequest();
		center.request(request);

		center.deny(request.requestId, "alice");

		expect(center.pending()).toEqual([]);
		expect(outcomes).toEqual([{ requestId: request.requestId, decision: "denied", decidedAt: expect.any(Number), decidedBy: "alice" }]);
	});

	it("approve()/deny() on a requestId that was never requested (or already resolved) is a no-op -- no capability minted, no outcome published", () => {
		const bus = createEventBus();
		const outcomes: BusMessage[] = [];
		bus.onAny("notification", (message) => outcomes.push(message));
		const center = createApprovalCenter({ bus });

		expect(center.approve("never-requested")).toBeUndefined();
		center.deny("never-requested");

		expect(outcomes).toEqual([]);
	});

	it("a request past its own expiresAt is excluded from pending() and reported as resolved (denied) exactly once, not lingering as actionable", () => {
		const bus = createEventBus();
		const outcomes: VehicleApprovalOutcome[] = [];
		bus.subscribe("notification", "vehicle.approval.resolved", (message) => outcomes.push(message.payload as VehicleApprovalOutcome));
		let clock = 1_000;
		const center = createApprovalCenter({ bus, now: () => clock });
		center.request(makeRequest({ expiresAt: 2_000 }));

		clock = 2_001;
		expect(center.pending()).toEqual([]);
		expect(center.pending()).toEqual([]); // idempotent: the second read doesn't re-publish a second outcome
		expect(outcomes).toHaveLength(1);
		expect(outcomes[0]).toMatchObject({ decision: "denied" });
	});

	it("approve() against an already-expired request is a no-op, exactly like a never-requested id", () => {
		const bus = createEventBus();
		let clock = 1_000;
		const center = createApprovalCenter({ bus, now: () => clock });
		const request = makeRequest({ expiresAt: 2_000 });
		center.request(request);

		clock = 2_001;
		expect(center.approve(request.requestId)).toBeUndefined();
	});

	it("REGRESSION (confused-deputy): a capability approved for one input can never be replayed against a different input, even for the same operation", () => {
		// The exact scenario from Doc 268443b0: Alice approves an agent's issue.create against a
		// small, reviewed repo -- the minted capability must not also authorize the SAME operation
		// against a completely different, unreviewed input the agent (or anything holding the
		// capability) might try next.
		const bus = createEventBus();
		const center = createApprovalCenter({ bus, authority: new HmacApprovalAuthority() });
		const approvedInput = { repo: "acme/widgets", title: "Fix login bug", body: "Users can't log in after..." };
		const request = makeRequest({ inputHash: hashApprovalInput(approvedInput) });
		center.request(request);
		const capability = center.approve(request.requestId)!;

		const differentInput = { repo: "acme/internal-secrets", title: "dump", body: "<credentials>" };

		expect(center.verifyCapability(capability, "issue.create", 1, differentInput)).toBe(false);
		// The original, actually-approved input still verifies -- this isn't a blanket "the
		// capability is broken," only the mismatched replay is rejected.
		expect(center.verifyCapability(capability, "issue.create", 1, approvedInput)).toBe(true);
	});

	it("REGRESSION (single-use): a capability verifies at most once, even for its own exact approved input", () => {
		const bus = createEventBus();
		const center = createApprovalCenter({ bus, authority: new HmacApprovalAuthority() });
		const approvedInput = { repo: "acme/widgets", title: "Fix login bug", body: "..." };
		const request = makeRequest({ inputHash: hashApprovalInput(approvedInput) });
		center.request(request);
		const capability = center.approve(request.requestId)!;

		expect(center.verifyCapability(capability, "issue.create", 1, approvedInput)).toBe(true);
		expect(center.verifyCapability(capability, "issue.create", 1, approvedInput)).toBe(false);
	});

	it("a capability never verifies against a different operationName or operationVersion than it was minted for", () => {
		const bus = createEventBus();
		const center = createApprovalCenter({ bus, authority: new HmacApprovalAuthority() });
		const approvedInput = { repo: "acme/widgets" };
		const request = makeRequest({ operationName: "issue.create", operationVersion: 1, inputHash: hashApprovalInput(approvedInput) });
		center.request(request);
		const capability = center.approve(request.requestId)!;

		expect(center.verifyCapability(capability, "issue.delete", 1, approvedInput)).toBe(false);
		expect(center.verifyCapability(capability, "issue.create", 2, approvedInput)).toBe(false);
	});

	it("bounds pending bookkeeping: adding past maxPending evicts the oldest still-pending request rather than growing unbounded", () => {
		const bus = createEventBus();
		const center = createApprovalCenter({ bus, maxPending: 2 });
		center.request(makeRequest({ requestId: "REQ-1" }));
		center.request(makeRequest({ requestId: "REQ-2" }));
		center.request(makeRequest({ requestId: "REQ-3" }));

		const ids = center.pending().map((request) => request.requestId);
		expect(ids).toEqual(["REQ-2", "REQ-3"]);
	});

	it("defaults to a real HmacApprovalAuthority (Date.now-based expiry) when none is injected -- mint/verify still round-trip end to end", () => {
		vi.useRealTimers();
		const bus = createEventBus();
		const center = createApprovalCenter({ bus });
		const approvedInput = { repo: "acme/widgets" };
		const request = makeRequest({ requestedAt: Date.now(), expiresAt: Date.now() + 60_000, inputHash: hashApprovalInput(approvedInput) });
		center.request(request);

		const capability = center.approve(request.requestId)!;

		expect(center.verifyCapability(capability, request.operationName, request.operationVersion, approvedInput)).toBe(true);
	});
});
