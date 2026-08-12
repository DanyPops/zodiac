import { z } from "zod";
import { SurfaceIdSchema, WindowIdSchema } from "./ids.js";

/** A Resource/Surface's own lifecycle state -- independent of whether it's currently visible or focused. */
export const ResourceStatusSchema = z.enum(["idle", "loading", "ready", "error"]);
export type ResourceStatus = z.infer<typeof ResourceStatusSchema>;

/**
 * Which package and capability produced a Resource/Surface -- carried at
 * runtime so `describe`-style introspection and structured logs can name a
 * contribution's real owner without guessing from its id shape.
 */
export const ProvenanceSchema = z.object({
	packageId: z.string().trim().min(1),
	capability: z.string().trim().min(1).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** At most one selected Surface at a time -- a Workspace-scoped cursor, not a multi-select set (out of scope for this protocol slice). */
export const SelectionStateSchema = z.object({
	surfaceId: SurfaceIdSchema.optional(),
});
export type SelectionState = z.infer<typeof SelectionStateSchema>;

/** Which Window (and, within it, which Surface) currently holds keyboard focus. */
export const FocusStateSchema = z.object({
	windowId: WindowIdSchema,
	surfaceId: SurfaceIdSchema.optional(),
});
export type FocusState = z.infer<typeof FocusStateSchema>;
