import { z } from "zod";
import { IntegrationIdSchema, ResourceIdSchema, SurfaceIdSchema, WindowIdSchema, WorkspaceIdSchema, WorldIdSchema, type WindowId } from "./ids.js";
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
const MAX_SURFACES_PER_WORKSPACE = MAX_WINDOWS_PER_WORKSPACE * MAX_SURFACES_PER_WINDOW;

/** Provider-neutral state with identity, version, and provenance -- the architecture's "Resource" concept. Operations live on the port that produced it, not on this wire shape. */
export const ResourceSchema = z.object({
	id: ResourceIdSchema,
	kind: z.string().trim().min(1),
	version: z.number().int().nonnegative(),
	status: ResourceStatusSchema,
	provenance: ProvenanceSchema.optional(),
});
export type Resource = z.infer<typeof ResourceSchema>;

/** The visible face of a typed Resource or external-system binding, docked into exactly one Window. `windowId` is the authoritative membership relation; Window projections derive their Surface collections from it. */
export const SurfaceSchema = z.object({
	id: SurfaceIdSchema,
	windowId: WindowIdSchema,
	integrationId: IntegrationIdSchema,
	title: z.string().trim().min(1),
	resource: ResourceSchema.optional(),
});
export type Surface = z.infer<typeof SurfaceSchema>;

/** An Integration's declared capability surface: renderable (has UI to dock into a Window's Surface), an API (exposes commands callable through the same dispatch path a human or an agent uses), or both. Neither flag set means the Integration is not addressable through the model at all. */
export const IntegrationCapabilitiesSchema = z
	.object({
		renderable: z.boolean(),
		hasApi: z.boolean(),
	})
	.refine((capabilities) => capabilities.renderable || capabilities.hasApi, { message: "An Integration must be renderable, expose an API, or both" });
export type IntegrationCapabilities = z.infer<typeof IntegrationCapabilitiesSchema>;

/** The minimal, framework-neutral contract an Integration's own (richer, host-specific) definition is expected to satisfy. */
export const IntegrationDefinitionSchema = z.object({
	id: IntegrationIdSchema,
	title: z.string().trim().min(1),
	capabilities: IntegrationCapabilitiesSchema,
});
export type IntegrationDefinition = z.infer<typeof IntegrationDefinitionSchema>;

/** One Workspace's numbered arrangement slot. It owns per-Window layout, not Surface membership; membership is derived from each Surface's authoritative `windowId`. */
export const WorkspaceWindowSchema = z
	.object({
		id: WindowIdSchema,
		title: z.string().trim().min(1),
	})
	.strict();
export type WorkspaceWindow = z.infer<typeof WorkspaceWindowSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One bounded compatibility migration for snapshots written before Surface
 * membership moved to the Workspace registry. Canonical input already has a
 * top-level `surfaces` field and never takes this path. A conflicting legacy
 * `windowId` is deliberately left unmodified so strict canonical parsing
 * rejects it rather than silently choosing one of two authorities.
 */
function migrateLegacyWindowSurfaces(input: unknown): unknown {
	if (!isRecord(input) || "surfaces" in input || !Array.isArray(input.windows)) return input;
	if (!input.windows.every((window) => isRecord(window) && Array.isArray(window.surfaces))) return input;

	const surfaces: unknown[] = [];
	const windows: unknown[] = [];
	for (const window of input.windows) {
		if (!isRecord(window) || !Array.isArray(window.surfaces)) return input;
		const { surfaces: legacySurfaces, ...canonicalWindow } = window;
		for (const surface of legacySurfaces) {
			if (!isRecord(surface) || ("windowId" in surface && surface.windowId !== window.id)) return input;
			surfaces.push({ ...surface, windowId: window.id });
		}
		windows.push(canonicalWindow);
	}
	return { ...input, windows, surfaces };
}

const CanonicalWorkspaceSchema = z
	.object({
		id: WorkspaceIdSchema,
		title: z.string().trim().min(1),
		windows: z.array(WorkspaceWindowSchema).min(1).max(MAX_WINDOWS_PER_WORKSPACE),
		surfaces: z.array(SurfaceSchema).max(MAX_SURFACES_PER_WORKSPACE),
		activeWindowIndex: z.number().int().nonnegative(),
	})
	.strict()
	.superRefine((workspace, context) => {
		if (workspace.activeWindowIndex >= workspace.windows.length) {
			context.addIssue({ code: "custom", path: ["activeWindowIndex"], message: "activeWindowIndex must reference an existing Window" });
		}
		const windowIds = new Set<WindowId>();
		for (const [index, window] of workspace.windows.entries()) {
			if (windowIds.has(window.id)) context.addIssue({ code: "custom", path: ["windows", index, "id"], message: `duplicate Window id "${window.id}"` });
			windowIds.add(window.id);
		}
		const surfaceIds = new Set<string>();
		const surfaceCountByWindow = new Map<WindowId, number>();
		for (const [index, surface] of workspace.surfaces.entries()) {
			if (surfaceIds.has(surface.id)) context.addIssue({ code: "custom", path: ["surfaces", index, "id"], message: `duplicate Surface id "${surface.id}"` });
			surfaceIds.add(surface.id);
			if (!windowIds.has(surface.windowId)) {
				context.addIssue({ code: "custom", path: ["surfaces", index, "windowId"], message: `Surface references unknown Window "${surface.windowId}"` });
				continue;
			}
			const count = (surfaceCountByWindow.get(surface.windowId) ?? 0) + 1;
			surfaceCountByWindow.set(surface.windowId, count);
			if (count > MAX_SURFACES_PER_WINDOW) context.addIssue({ code: "custom", path: ["surfaces", index], message: `Window "${surface.windowId}" exceeds ${MAX_SURFACES_PER_WINDOW} Surfaces` });
		}
	});

/** A bounded, independently-lifecycled SDLC scope and agent permission boundary. Surface records live here so `Surface.windowId` is the sole persisted membership authority. */
export const WorkspaceSchema = z.preprocess(migrateLegacyWindowSurfaces, CanonicalWorkspaceSchema);
export type Workspace = z.infer<typeof WorkspaceSchema>;

/** The daemon-owned live object graph and lifecycle boundary -- every Workspace it currently holds. Window and Surface ids are globally unique because WorldStore indexes both without a Workspace-qualified composite key. */
export const WorldSchema = z
	.object({
		id: WorldIdSchema,
		workspaces: z.array(WorkspaceSchema).max(MAX_WORKSPACES_PER_WORLD),
	})
	.strict()
	.superRefine((world, context) => {
		const workspaceIds = new Set<string>();
		const windowIds = new Set<string>();
		const surfaceIds = new Set<string>();
		for (const [workspaceIndex, workspace] of world.workspaces.entries()) {
			if (workspaceIds.has(workspace.id)) context.addIssue({ code: "custom", path: ["workspaces", workspaceIndex, "id"], message: `duplicate Workspace id "${workspace.id}"` });
			workspaceIds.add(workspace.id);
			for (const [windowIndex, window] of workspace.windows.entries()) {
				if (windowIds.has(window.id)) context.addIssue({ code: "custom", path: ["workspaces", workspaceIndex, "windows", windowIndex, "id"], message: `duplicate Window id "${window.id}" across World` });
				windowIds.add(window.id);
			}
			for (const [surfaceIndex, surface] of workspace.surfaces.entries()) {
				if (surfaceIds.has(surface.id)) context.addIssue({ code: "custom", path: ["workspaces", workspaceIndex, "surfaces", surfaceIndex, "id"], message: `duplicate Surface id "${surface.id}" across World` });
				surfaceIds.add(surface.id);
			}
		}
	});
export type World = z.infer<typeof WorldSchema>;
