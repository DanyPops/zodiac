/**
 * The gating half of the HITL flow approval-center.ts's own doc comment
 * deferred: wraps a real IntegrationInvokeHandler so a gated effect invoked
 * without a valid capability durably parks a VehicleApprovalRequest (via
 * ApprovalCenter) instead of running, and a resubmission carrying a minted
 * capability (world/store.ts's own IntegrationInvokeHandler `context`
 * parameter, CommandIntent's own `approvalCapability` field) is verified for
 * real -- operation, version, and exact input, not merely non-empty --
 * before the real handler ever runs. Mirrors @danypops/vehicle-server's own
 * ApprovalPolicy.enforceGate() shape (this workspace's reuse mandate:
 * Zodiac's own thin adapter over Vehicle's mechanism, not a second one).
 */
import { randomUUID } from "node:crypto";
import { DEFAULT_APPROVAL_EFFECTS, DEFAULT_APPROVAL_TIMEOUT_MS, type VehicleApprovalRequest, type VehicleEffect, type VehiclePrincipal } from "@danypops/vehicle-core";
import { hashApprovalInput } from "@danypops/vehicle-server/approval-authority";
import type { ContributionOutcome } from "@zodiac/protocol";
import type { IntegrationInvokeContext } from "../world/store.js";
import type { ApprovalCenter } from "./approval-center.js";

export interface GatedIntegrationInvokeOptions {
	/** The real Integration handler -- only ever invoked once a valid capability is verified (or the operation isn't gated at all). */
	readonly handler: (action: string, input: unknown, context?: IntegrationInvokeContext) => ContributionOutcome<unknown>;
	readonly approvalCenter: ApprovalCenter;
	/** The stable name/version a VehicleApprovalRequest for this operation is minted/verified under -- mirrors a real Vehicle operation descriptor's own name/version, kept stable across calls so a minted capability's own operationName/operationVersion check lines up. */
	readonly operationName: string;
	readonly operationVersion: number;
	readonly effect: VehicleEffect;
	/** Which effects require approval at all -- defaults to VehicleApprovalAuthority's own DEFAULT_APPROVAL_EFFECTS ("destructive", "open-world"), the same default a real Vehicle registry ships with. */
	readonly gatedEffects?: readonly VehicleEffect[];
	readonly timeoutMs?: number;
	readonly principal?: VehiclePrincipal;
	/** Injectable for deterministic tests; defaults to Date.now. */
	readonly now?: () => number;
}

/** Wraps `handler` with the gate described in this module's own doc comment. Returned function is a real IntegrationInvokeHandler, suitable for WorldStore.registerIntegrationInvokeHandler. */
export function createGatedIntegrationInvokeHandler(options: GatedIntegrationInvokeOptions): (action: string, input: unknown, context?: IntegrationInvokeContext) => ContributionOutcome<unknown> {
	const gatedEffects = options.gatedEffects ?? DEFAULT_APPROVAL_EFFECTS;
	const now = options.now ?? Date.now;

	return (action, input, context) => {
		if (!gatedEffects.includes(options.effect)) return options.handler(action, input, context);

		const inputHash = hashApprovalInput(input);

		if (context?.presentedCapability) {
			if (options.approvalCenter.verifyCapability(context.presentedCapability, options.operationName, options.operationVersion, input)) {
				return options.handler(action, input, context);
			}
			return { ok: false, code: "approval-capability-invalid", message: `The presented approval capability doesn't verify for operation "${options.operationName}" v${String(options.operationVersion)} with this exact input.` };
		}

		const requestedAt = now();
		const request: VehicleApprovalRequest = {
			requestId: randomUUID(),
			operationName: options.operationName,
			operationVersion: options.operationVersion,
			effect: options.effect,
			principal: options.principal,
			requestedAt,
			expiresAt: requestedAt + (options.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS),
			inputHash,
		};
		options.approvalCenter.request(request);
		return { ok: false, code: "approval-required", message: `Operation "${options.operationName}" is gated (effect: ${options.effect}) and has no valid capability; a VehicleApprovalRequest (${request.requestId}) has been recorded pending human approval.` };
	};
}
