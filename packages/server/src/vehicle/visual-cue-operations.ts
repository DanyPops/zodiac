/**
 * The first real Vehicle-registered operation zodiacd hosts (as opposed to the earlier
 * hand-authored zodiac_dispatch_command/list_integrations Pi tools, which predate this and stay
 * unchanged). See the owning task's own body for the full design history and two corrections:
 * gating is unconditional (`requiresApproval: true`), never computed from `steps`' own content --
 * VehicleOperationDescriptor's gating fields are frozen at defineVehicleOperation() call time,
 * with no per-invocation hook, confirmed by direct read of enforceGate()'s own signature.
 *
 * Grant-governed Job execution (see the "propose_visual_cue: Grant-governed Job execution"
 * Papyrus Task): `background: {supported: true}` lets `invokeOrRunAsJob` (vehicle-client-pi)
 * dispatch this operation through a real Vehicle Job instead of one held-open live invoke() call
 * -- transparent to the model, no new tool surface. A proposal with more steps than
 * `FREE_STEP_BUDGET` asks Vehicle's own Grant primitive for more budget before accepting,
 * exactly the pattern proven in vehicle-server's own vehicle-grant.test.ts: invoke
 * vehicle.grant.continue, catch a real approval-required VehicleError, suspend via
 * context.steerInputs, resume once a human approves (or throw once explicitly denied). A small
 * proposal (at or under the free budget) never touches Grant at all -- unconditional
 * requiresApproval already gates the whole operation regardless of size; Grant additionally
 * governs *how large a single already-approved proposal may be* before needing a fresh ask.
 */
import { bindVehicleOperation, defineVehicleOperation, defineVehicleSchema, grantBudgetExhausted, isVehicleError, mergeGrantBudget, VehicleError, type VehicleGrantBudget } from "@danypops/vehicle-core";
import type { VehicleRegistry } from "@danypops/vehicle-server";
import { VEHICLE_GRANT_CONTINUE_OPERATION_NAME } from "@danypops/vehicle-server/grant";

export const VISUAL_CUE_PROPOSE_OPERATION_NAME = "visual-cue.propose";

/** A proposal at or under this many steps is accepted without ever consulting Grant -- only a genuinely large sequence needs the extra ask. */
export const FREE_STEP_BUDGET = 5;

export interface VisualCueStepTarget {
	readonly kind: string;
	readonly id: string;
	readonly workspaceId?: string;
}

export interface VisualCueStep {
	readonly target: VisualCueStepTarget;
	readonly cue: string;
}

export interface VisualCueProposeInput {
	readonly title: string;
	readonly steps: readonly VisualCueStep[];
}

export interface VisualCueProposeOutput {
	readonly accepted: true;
	readonly stepCount: number;
}

function isVisualCueStepTarget(value: unknown): value is VisualCueStepTarget {
	if (typeof value !== "object" || value === null) return false;
	const row = value as Record<string, unknown>;
	if (typeof row["kind"] !== "string" || !row["kind"].trim()) return false;
	if (typeof row["id"] !== "string" || !row["id"].trim()) return false;
	if (row["workspaceId"] !== undefined && typeof row["workspaceId"] !== "string") return false;
	return true;
}

function isVisualCueStep(value: unknown): value is VisualCueStep {
	if (typeof value !== "object" || value === null) return false;
	const row = value as Record<string, unknown>;
	return isVisualCueStepTarget(row["target"]) && typeof row["cue"] === "string" && row["cue"].trim().length > 0;
}

const inputSchema = defineVehicleSchema<VisualCueProposeInput>({
	jsonSchema: {
		type: "object",
		properties: {
			title: { type: "string", minLength: 1 },
			steps: { type: "array", items: { type: "object" }, minItems: 1 },
		},
		required: ["title", "steps"],
		additionalProperties: false,
	},
	safeParse(value) {
		if (typeof value !== "object" || value === null) return { success: false, issues: [{ path: [], message: "input must be an object" }] };
		const row = value as Record<string, unknown>;
		if (typeof row["title"] !== "string" || !row["title"].trim()) {
			return { success: false, issues: [{ path: ["title"], message: "title must be a non-empty string" }] };
		}
		if (!Array.isArray(row["steps"]) || row["steps"].length === 0) {
			return { success: false, issues: [{ path: ["steps"], message: "steps must be a non-empty array" }] };
		}
		if (!row["steps"].every(isVisualCueStep)) {
			return { success: false, issues: [{ path: ["steps"], message: "every step must have a {kind, id} target and a non-empty cue" }] };
		}
		return { success: true, value: { title: row["title"], steps: row["steps"] as readonly VisualCueStep[] } };
	},
});

const outputSchema = defineVehicleSchema<VisualCueProposeOutput>({
	jsonSchema: {
		type: "object",
		properties: { accepted: { type: "boolean" }, stepCount: { type: "number" } },
		required: ["accepted", "stepCount"],
		additionalProperties: false,
	},
	safeParse(value) {
		const row = value as { accepted?: unknown; stepCount?: unknown };
		if (row?.accepted !== true || typeof row.stepCount !== "number") {
			return { success: false, issues: [{ path: [], message: "invalid visual-cue.propose output" }] };
		}
		return { success: true, value: { accepted: true, stepCount: row.stepCount } };
	},
});

/**
 * Registers visual-cue.propose against `registry`. Call after `registry.configureApprovals(...)`
 * so `requiresApproval: true` actually has a policy to be gated by (harmless either order --
 * `resolvesToApprovalRequired()` is false until configureApprovals() runs -- but there is then
 * nothing to gate against until that call happens). Also call
 * `registerVehicleGrantOperation(registry)` (from `@danypops/vehicle-server/grant`) once,
 * daemon-wide, before this -- `vehicle.grant.continue` must already be registered for the
 * Grant-aware step below to have anything to invoke.
 *
 * The handler's own real work is still just acknowledging -- browser-side relay of the approved
 * steps over the notification transport is real, separate, not-yet-built scope (see the owning
 * task's own body). The Grant check below governs *whether this call may proceed at all* given
 * its own size, not the (not-yet-built) execution of its steps.
 */
export function registerVisualCueOperations(registry: VehicleRegistry): void {
	const operation = defineVehicleOperation({
		name: VISUAL_CUE_PROPOSE_OPERATION_NAME,
		version: 1,
		description: "Proposes a sequenced visual-cue walkthrough (highlight/pulse/scroll-to, optionally a real dispatched command) for human approval before ever running.",
		input: inputSchema,
		output: outputSchema,
		permissions: [],
		effect: "external-write",
		requiresApproval: true,
		idempotency: { mode: "unsafe" },
		longRunning: true,
		limits: { defaultTimeoutMs: 5_000, maxTimeoutMs: 5_000, maxRequestBytes: 16_384, maxResponseBytes: 1_024 },
		// VehicleJobWakeBudget (this Job's own per-wake-cycle allowance: {maxCount, maxBytes}) is a
		// genuinely different type from VehicleGrantBudget (the agent-facing {maxTurns, ...} resource
		// ceiling the handler itself uses below, via FREE_STEP_BUDGET) -- confirmed directly, a real
		// type mismatch caught before assuming they were interchangeable. This operation's own
		// single-shot handler needs no real wake-cycle budgeting of its own (it returns in one tick
		// once ungated), so these are left generous/unbounded-in-practice rather than tuned.
		background: {
			supported: true,
			defaultWakeBudget: { maxCount: 100, maxBytes: 100_000 },
			maxWakeBudget: { maxCount: 100, maxBytes: 100_000 },
		},
	});
	registry.register(
		"visual-cue",
		bindVehicleOperation(operation, () => async (context) => {
			const stepCount = context.input.steps.length;
			let remaining: VehicleGrantBudget = mergeGrantBudget({ maxTurns: FREE_STEP_BUDGET }, { maxTurns: -stepCount });
			const steerIterator = context.steerInputs?.[Symbol.asyncIterator]();
			while (grantBudgetExhausted(remaining)) {
				context.reportProgress({ phase: "awaiting-grant-approval", stepCount, freeStepBudget: FREE_STEP_BUDGET });
				try {
					await registry.invoke(VEHICLE_GRANT_CONTINUE_OPERATION_NAME, 1, { requestedBudget: { maxTurns: stepCount } });
					// Grant approvals aren't configured at all (ungated) -- proceed with whatever budget already is.
					break;
				} catch (error) {
					if (!isVehicleError(error) || error.code !== "approval-required") throw error;
					if (!steerIterator) throw error;
					const { value } = await steerIterator.next();
					if (value && typeof value === "object" && (value as { denied?: boolean }).denied) {
						// A real VehicleError, not a plain Error -- the registry's own handler-invocation
						// wrapper (`if (isVehicleError(error)) throw error;`) only ever preserves an
						// already-VehicleError's own message verbatim; a plain Error gets rewrapped into a
						// generic "... handler failed" message, losing this denial's own real reason --
						// confirmed directly, not assumed, before shipping this.
						throw new VehicleError("grant-continuation-denied", `visual-cue.propose: Grant continuation denied for a ${String(stepCount)}-step proposal`, { category: "authorization", retryable: false });
					}
					remaining = mergeGrantBudget(remaining, value as VehicleGrantBudget);
				}
			}
			return { accepted: true, stepCount };
		}),
	);
}
