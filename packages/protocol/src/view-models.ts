import type { ResourceStatus } from "./status.js";
import type { IntegrationId, SurfaceId, WindowId, WorkspaceId } from "./ids.js";
import type { SurfaceTile } from "./tile.js";

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
