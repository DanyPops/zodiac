/**
 * HITL approval, built directly on @danypops/vehicle-core's VehicleApprovalRequest/
 * VehicleApprovalAuthority and @danypops/vehicle-server's real HmacApprovalAuthority --
 * per this workspace's own reuse mandate (Doc "Zodiac multi-agent, integration-defined-abilities
 * architecture"), this is not a new approval model, just Zodiac's own thin adapter over one.
 *
 * A gated Vehicle-backed operation invoked without a valid capability durably emits a
 * VehicleApprovalRequest (a real Vehicle Event, not a Zodiac-invented shape) before any
 * interactive prompt. ApprovalCenter is where that request lands on Zodiac's own side: tracked as
 * pending, published on the event bus's "notification" channel for NotificationsPill to render,
 * and resolved (granted mints a capability; denied does not) through the same
 * VehicleApprovalAuthority instance the original gated call's own verify() will check against.
 *
 * Scope note: this wires the domain half of the HITL flow (request/pending/approve/deny/verify)
 * against a real authority and a real event bus. Re-invoking the original CommandIntent with a
 * freshly-minted capability once approved -- and rendering a human-meaningful summary of the
 * original input, not just operationName/effect -- depends on the `integration.invoke`
 * CommandIntent variant (a separate, not-yet-built prerequisite task) to correlate a
 * VehicleApprovalRequest back to the CommandIntent that triggered it. Deliberately not attempted
 * here rather than half-built against a dispatch path that doesn't exist yet.
 */
import { hashApprovalInput, HmacApprovalAuthority } from "@danypops/vehicle-server/approval-authority";
import type { VehicleApprovalAuthority, VehicleApprovalOutcome, VehicleApprovalRequest } from "@danypops/vehicle-core";
import type { EventBus } from "../event/bus.js";

/** Bounds pending-request bookkeeping the same way every other Zodiac-side capacity is bounded (see EventBus's own maxTrackedCorrelations) -- a real deployment with thousands of simultaneously pending, never-resolved requests isn't a case worth sizing for. */
const DEFAULT_MAX_PENDING = 256;

export interface ApprovalCenterOptions {
	readonly bus: EventBus;
	/** Defaults to a fresh HmacApprovalAuthority with a random secret. Inject a shared instance so mint() (here) and verify() (wherever the original gated call re-checks) agree on the same secret. */
	readonly authority?: VehicleApprovalAuthority;
	readonly maxPending?: number;
	/** Injectable for deterministic tests; defaults to Date.now. */
	readonly now?: () => number;
}

export interface ApprovalCenter {
	/** Records a newly-received VehicleApprovalRequest as pending and publishes it on the bus's "notification" channel, type "vehicle.approval.requested". Replacing an existing pending request for the same requestId (a redelivered event) is idempotent, not a duplicate. */
	request(request: VehicleApprovalRequest): void;
	/** Every currently pending request, oldest first, excluding any whose expiresAt has already passed (an expired request is reported as resolved-by-lapsing on first observation here, same as an explicit deny, rather than lingering as if still actionable). */
	pending(): readonly VehicleApprovalRequest[];
	/** Mints a capability for a pending, unexpired request and publishes its VehicleApprovalOutcome ("granted") on the bus. Returns undefined -- and mints nothing -- for a requestId that isn't currently pending (already resolved, expired, or never requested). */
	approve(requestId: string, decidedBy?: string): string | undefined;
	/** Publishes a VehicleApprovalOutcome ("denied") for a pending request without ever minting a capability. A no-op (no publish) for a requestId that isn't currently pending. */
	deny(requestId: string, decidedBy?: string): void;
	/** Convenience over authority.verify(): hashes the raw input the same way vehicle-server's own gated invoke() does (hashApprovalInput) before checking it against the capability's own signed inputHash. */
	verifyCapability(capability: string, operationName: string, operationVersion: number, input: unknown): boolean;
}

export function createApprovalCenter(options: ApprovalCenterOptions): ApprovalCenter {
	const authority = options.authority ?? new HmacApprovalAuthority();
	const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
	const now = options.now ?? Date.now;

	const pendingById = new Map<string, VehicleApprovalRequest>();

	function publishOutcome(outcome: VehicleApprovalOutcome): void {
		options.bus.publish("notification", { type: "vehicle.approval.resolved", correlationId: outcome.requestId, payload: outcome });
	}

	function dropExpired(): void {
		const nowMs = now();
		for (const [requestId, request] of pendingById) {
			if (request.expiresAt <= nowMs) {
				pendingById.delete(requestId);
				publishOutcome({ requestId, decision: "denied", decidedAt: nowMs });
			}
		}
	}

	return {
		request(request) {
			if (!pendingById.has(request.requestId) && pendingById.size >= maxPending) {
				const oldestId = pendingById.keys().next().value;
				if (oldestId !== undefined) pendingById.delete(oldestId);
			}
			pendingById.set(request.requestId, request);
			options.bus.publish("notification", { type: "vehicle.approval.requested", correlationId: request.requestId, payload: request });
		},

		pending() {
			dropExpired();
			return [...pendingById.values()];
		},

		approve(requestId, decidedBy) {
			dropExpired();
			const request = pendingById.get(requestId);
			if (!request) return undefined;
			pendingById.delete(requestId);
			const capability = authority.mint(request);
			publishOutcome({ requestId, decision: "granted", decidedAt: now(), decidedBy });
			return capability;
		},

		deny(requestId, decidedBy) {
			dropExpired();
			if (!pendingById.has(requestId)) return;
			pendingById.delete(requestId);
			publishOutcome({ requestId, decision: "denied", decidedAt: now(), decidedBy });
		},

		verifyCapability(capability, operationName, operationVersion, input) {
			return authority.verify(capability, operationName, operationVersion, hashApprovalInput(input));
		},
	};
}
