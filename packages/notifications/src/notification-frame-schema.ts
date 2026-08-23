import { VEHICLE_EFFECTS } from "@danypops/vehicle-core";
import { z } from "zod";

/**
 * Structurally identical to @danypops/vehicle-core's own JsonValue (not
 * imported -- that package exports the interface, not the type, from its
 * public entry point), so it type-checks as assignable to
 * `VehiclePrincipal.claims` by TypeScript's own structural typing without
 * a cast. Recursive, so declared with z.lazy(). Depth is bounded
 * implicitly by the surrounding claims object's own field-count cap, not
 * recursion depth itself; a pathologically deep value still parses
 * correctly -- this codebase never interprets `claims`, only ever
 * displays it redacted per the existing Vehicle credential-safety
 * convention, so unbounded recursion depth is not a real exposure here.
 */
type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]));

/**
 * Runtime-validated mirror of `@danypops/vehicle-core`'s `VehicleApprovalRequest`
 * -- that package ships the interface only, no zod schema, so a
 * daemon-to-browser SSE frame previously trusted it via `type is string`
 * alone (the task's own "then trusts Vehicle approval payloads" finding).
 * Bounded string/number lengths throughout: this is untrusted wire data
 * from a network hop, not an in-process value already produced by
 * `vehicle-core` itself.
 */
export const VehicleApprovalRequestSchema = z.object({
	requestId: z.string().min(1).max(200),
	operationName: z.string().min(1).max(200),
	operationVersion: z.number().int().nonnegative(),
	effect: z.enum(VEHICLE_EFFECTS),
	principal: z
		.object({
			id: z.string().min(1).max(200),
			claims: z.record(z.string().max(200), JsonValueSchema).optional(),
		})
		.optional(),
	requestedAt: z.number().int().nonnegative(),
	expiresAt: z.number().int().nonnegative(),
	inputHash: z.string().min(1).max(200),
});

export const NotificationFrameSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("notifications.snapshot"), pending: z.array(VehicleApprovalRequestSchema).max(500) }),
	z.object({ type: z.literal("vehicle.approval.requested"), payload: VehicleApprovalRequestSchema }),
	z.object({ type: z.literal("vehicle.approval.resolved"), payload: z.object({ requestId: z.string().min(1).max(200) }) }),
]);

export type NotificationFrame = z.infer<typeof NotificationFrameSchema>;
