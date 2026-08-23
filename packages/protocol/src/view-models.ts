import { z } from "zod";
import { ResourceStatusSchema, type ResourceStatus } from "./status.js";
import { IntegrationIdSchema, SurfaceIdSchema, WindowIdSchema, WorkspaceIdSchema, type IntegrationId, type SurfaceId, type WindowId, type WorkspaceId } from "./ids.js";
import { SurfaceTileSchema, type SurfaceTile } from "./tile.js";

/**
 * Runtime-validated entities (entities.ts) describe what a World *stores*.
 * A view model describes what a renderer *reads*: a plain, JSON-shaped
 * projection -- selection/focus already resolved into booleans, no
 * optional-chaining required at the render site. Every renderer (React,
 * TUI, or a headless consumer with no renderer at all) consumes the same
 * shape.
 */
export interface SurfaceViewModel {
	readonly id: SurfaceId;
	readonly integrationId: IntegrationId;
	readonly title: string;
	readonly status: ResourceStatus;
	readonly selected: boolean;
}

export interface WindowViewModel {
	readonly id: WindowId;
	readonly title: string;
	readonly active: boolean;
	readonly surfaces: readonly SurfaceViewModel[];
	/** This Window's current tile layout, or null if it has no docked Surfaces. */
	readonly tile: SurfaceTile | null;
}

export interface WorkspaceViewModel {
	readonly id: WorkspaceId;
	readonly title: string;
	readonly activeWindowId: WindowId;
	readonly windows: readonly WindowViewModel[];
	/**
	 * Every IntegrationId with at least one docked Surface anywhere in this
	 * Workspace, deduped, in first-docked order across Windows. A Workspace
	 * is a context pool -- an Integration counts as "active" the same way
	 * whether its Surface sits in the active Window or any other Window in
	 * this Workspace, never scoped to just one.
	 */
	readonly activeIntegrationIds: readonly IntegrationId[];
}

/**
 * Runtime validators mirroring the three interfaces above -- for the wire
 * boundary only (parsing a daemon HTTP/SSE payload into a trusted
 * WorldViewModel), not a replacement for the hand-written interfaces
 * themselves, which every existing in-process caller keeps using unchanged.
 * Bounded array lengths throughout: this is untrusted network data, not an
 * already-validated in-process value.
 */
export const SurfaceViewModelSchema = z.object({
	id: SurfaceIdSchema,
	integrationId: IntegrationIdSchema,
	title: z.string().max(500),
	status: ResourceStatusSchema,
	selected: z.boolean(),
});

export const WindowViewModelSchema = z.object({
	id: WindowIdSchema,
	title: z.string().max(500),
	active: z.boolean(),
	surfaces: z.array(SurfaceViewModelSchema).max(256),
	tile: SurfaceTileSchema.nullable(),
});

export const WorkspaceViewModelSchema = z.object({
	id: WorkspaceIdSchema,
	title: z.string().max(500),
	activeWindowId: WindowIdSchema,
	windows: z.array(WindowViewModelSchema).max(256),
	activeIntegrationIds: z.array(IntegrationIdSchema).max(256),
});
