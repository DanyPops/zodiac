import { z } from "zod";

const BoundedId = z.string().trim().min(1).max(200);
const BoundedText = z.string().trim().min(1).max(2_048);
const VehicleEffectSchema = z.enum(["read", "local-write", "external-write", "destructive", "open-world"]);
const VehicleFailureCategorySchema = z.enum(["validation", "not_found", "conflict", "authorization", "capacity", "timeout", "cancelled", "unavailable", "internal"]);

export const VehicleSurfaceOperationSchema = z.object({
	name: BoundedId,
	version: z.number().int().positive(),
	description: BoundedText,
	effect: VehicleEffectSchema,
	available: z.boolean(),
	unavailableReason: z.string().max(2_048).optional(),
	approvalRequired: z.boolean(),
	permissions: z.array(z.string().trim().min(1).max(200)).max(64),
	limits: z.object({
		defaultTimeoutMs: z.number().int().positive().max(24 * 60 * 60 * 1_000),
		maxTimeoutMs: z.number().int().positive().max(24 * 60 * 60 * 1_000),
		maxRequestBytes: z.number().int().positive().max(64 * 1024 * 1024),
		maxResponseBytes: z.number().int().positive().max(64 * 1024 * 1024),
	}),
});
export type VehicleSurfaceOperation = z.infer<typeof VehicleSurfaceOperationSchema>;

export const VehicleSurfaceEventDescriptorSchema = z.object({
	name: BoundedId,
	version: z.number().int().positive(),
	description: BoundedText,
	maxPayloadBytes: z.number().int().positive().max(16 * 1024 * 1024),
});
export type VehicleSurfaceEventDescriptor = z.infer<typeof VehicleSurfaceEventDescriptorSchema>;

export const VehicleSurfaceManifestSchema = z.object({
	id: BoundedId,
	title: z.string().trim().min(1).max(200),
	vehicle: z.object({ name: BoundedId, version: z.string().trim().min(1).max(100), description: BoundedText }),
	operations: z.array(VehicleSurfaceOperationSchema).max(512),
	events: z.array(VehicleSurfaceEventDescriptorSchema).max(256),
});
export type VehicleSurfaceManifest = z.infer<typeof VehicleSurfaceManifestSchema>;

export const VehicleSurfaceInvokeRequestSchema = z.object({
	name: BoundedId,
	version: z.number().int().positive(),
	input: z.unknown(),
	idempotencyKey: z.string().trim().min(1).max(500).optional(),
	expectedRevision: z.union([z.string().max(500), z.number().finite()]).optional(),
});
export type VehicleSurfaceInvokeRequest = z.infer<typeof VehicleSurfaceInvokeRequestSchema>;

export const VehicleSurfaceFailureSchema = z.object({
	code: BoundedId,
	category: VehicleFailureCategorySchema,
	message: z.string().max(4_096),
	retryable: z.boolean(),
	retryAfterMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1_000).optional(),
	operationId: z.string().max(500).optional(),
});
export type VehicleSurfaceFailure = z.infer<typeof VehicleSurfaceFailureSchema>;

export const VehicleSurfaceInvokeResultSchema = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true), output: z.unknown(), operationId: z.string().max(500).optional() }),
	z.object({ ok: z.literal(false), error: VehicleSurfaceFailureSchema }),
]);
export type VehicleSurfaceInvokeResult = z.infer<typeof VehicleSurfaceInvokeResultSchema>;

export const VehicleSurfaceEventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("event"), surfaceId: BoundedId, topic: BoundedId, payload: z.unknown() }),
	z.object({ type: z.literal("state"), surfaceId: BoundedId, state: z.enum(["connecting", "live", "degraded", "closed"]) }),
]);
export type VehicleSurfaceEvent = z.infer<typeof VehicleSurfaceEventSchema>;
