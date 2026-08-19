/**
 * The one CQRS-shaped bridge that lets ApprovalCenter act as a single queryable read model over
 * BOTH gate sources -- WorldStore.apply()'s own integration.invoke gate (which already calls
 * ApprovalCenter.request() directly, see gated-integration-invoke.ts) and any real
 * VehicleRegistry operation gated via configureApprovals() (whose own pending-request bookkeeping,
 * VehicleApprovalPolicyManager.pendingApprovals, is private with no public accessor anywhere on
 * VehicleRegistry -- confirmed by direct read, not assumed).
 *
 * This is exactly CQRS's own "projection" concept, not a bespoke workaround: Vehicle's approval
 * workflow is write/event-oriented with no query API of its own, so ApprovalCenter's `pending()`
 * becomes the read model, fed by folding vehicle.approval.requested events as they arrive (see
 * cqrs.com's own definition: "A projection takes in one or more events and produces derived
 * state -- often in the form of a read model").
 *
 * The other half of the design -- ApprovalCenter.approve()/deny() remaining the ONLY resolution
 * path, never registry.invoke("vehicle.approval.resolve", ...) -- needs no code here at all: as
 * long as ApprovalCenter and this registry's own configureApprovals() share the same
 * VehicleApprovalAuthority instance, a capability ApprovalCenter mints verifies correctly
 * wherever later presented (a WorldStore-gated retry or a registry-gated one), because mint()/
 * verify() are pure functions of the shared secret -- ordinary HMAC usage, not a special case.
 */
import type { VehicleApprovalRequest } from "@danypops/vehicle-core";
import type { VehicleRegistry } from "@danypops/vehicle-server";
import type { ApprovalCenter } from "./approval-center.js";

const VEHICLE_APPROVAL_REQUESTED_EVENT_NAME = "vehicle.approval.requested";
const VEHICLE_APPROVAL_REQUESTED_EVENT_VERSION = 1;

/** Forwards `registry`'s own approval-requested events into `approvalCenter.request()`. Returns an unsubscribe function (registry.subscribeLocal's own return value), for a caller that wants to tear the bridge down (e.g. in a test). Idempotent-per-request: ApprovalCenter.request() itself already treats a redelivered requestId as a no-op replace, not a duplicate. */
export function bridgeVehicleRegistryApprovals(registry: VehicleRegistry, approvalCenter: ApprovalCenter): () => void {
	return registry.subscribeLocal(VEHICLE_APPROVAL_REQUESTED_EVENT_NAME, VEHICLE_APPROVAL_REQUESTED_EVENT_VERSION, (payload) => {
		approvalCenter.request(payload as VehicleApprovalRequest);
	});
}
