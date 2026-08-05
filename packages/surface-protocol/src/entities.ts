import { z } from "zod";
import { ResourceIdSchema, SurfaceIdSchema, SurfaceTemplateIdSchema, WindowIdSchema, WorkspaceIdSchema, WorldIdSchema } from "./ids.js";
import { ProvenanceSchema, ResourceStatusSchema } from "./status.js";

/**
 * Every bound below is explicit and small on purpose: a World is a live,
 * daemon-held object graph, not an archive -- an unbounded array here would
 * let one malformed or adversarial snapshot/contribution payload force an
 * unbounded parse/render cost on every client that loads it.
 */
const MAX_WORKSPACES_PER_WORLD = 256;
const MAX_WINDOWS_PER_WORKSPACE = 64;
const MAX_SURFACES_PER_WINDOW = 128;

/** Provider-neutral state with identity, version, and provenance -- the architecture's "Resource" concept. Operations live on the port that produced it, not on this wire shape. */
export const ResourceSchema = z.object({
	id: ResourceIdSchema,
	kind: z.string().trim().min(1),
	version: z.number().int().nonnegative(),
	status: ResourceStatusSchema,
	provenance: ProvenanceSchema.optional(),
});
export type Resource = z.infer<typeof ResourceSchema>;

/** The visible face of a typed Resource or external-system binding, docked into exactly one Window. */
export const SurfaceSchema = z.object({
	id: SurfaceIdSchema,
	templateId: SurfaceTemplateIdSchema,
	title: z.string().trim().min(1),
	resource: ResourceSchema.optional(),
});
export type Surface = z.infer<typeof SurfaceSchema>;

/** One Workspace's numbered arrangement slot; owns its own independent set of docked Surfaces. */
export const WorkspaceWindowSchema = z.object({
	id: WindowIdSchema,
	title: z.string().trim().min(1),
	surfaces: z.array(SurfaceSchema).max(MAX_SURFACES_PER_WINDOW),
});
export type WorkspaceWindow = z.infer<typeof WorkspaceWindowSchema>;

/** A bounded, independently-lifecycled SDLC scope and agent permission boundary. */
export const WorkspaceSchema = z.object({
	id: WorkspaceIdSchema,
	title: z.string().trim().min(1),
	windows: z.array(WorkspaceWindowSchema).min(1).max(MAX_WINDOWS_PER_WORKSPACE),
	activeWindowIndex: z.number().int().nonnegative(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

/** The daemon-owned live object graph and lifecycle boundary -- every Workspace it currently holds. */
export const WorldSchema = z.object({
	id: WorldIdSchema,
	workspaces: z.array(WorkspaceSchema).max(MAX_WORKSPACES_PER_WORLD),
});
export type World = z.infer<typeof WorldSchema>;
