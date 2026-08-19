/**
 * The first real Vehicle-registered operation zodiacd hosts (as opposed to the earlier
 * hand-authored zodiac_dispatch_command/list_integrations Pi tools, which predate this and stay
 * unchanged). See the owning task's own body for the full design history and two corrections:
 * gating is unconditional (`requiresApproval: true`), never computed from `steps`' own content --
 * VehicleOperationDescriptor's gating fields are frozen at defineVehicleOperation() call time,
 * with no per-invocation hook, confirmed by direct read of enforceGate()'s own signature.
 */
import { bindVehicleOperation, defineVehicleOperation, defineVehicleSchema } from "@danypops/vehicle-core";
import type { VehicleRegistry } from "@danypops/vehicle-server";

export const VISUAL_CUE_PROPOSE_OPERATION_NAME = "visual-cue.propose";

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
 * nothing to gate against until that call happens).
 *
 * The handler itself does nothing beyond acknowledging -- browser-side relay of the approved
 * steps over the notification transport, and Grant-governed Job execution of any step carrying
 * a real CommandIntent, are real, separate, not-yet-built scope (see the owning task's own body).
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
		limits: { defaultTimeoutMs: 5_000, maxTimeoutMs: 5_000, maxRequestBytes: 16_384, maxResponseBytes: 1_024 },
	});
	registry.register(
		"visual-cue",
		bindVehicleOperation(operation, () => async (context) => ({ accepted: true, stepCount: context.input.steps.length })),
	);
}
