import type { WorldViewModel } from "@zodiac/protocol";
import type { WorkspaceLifecycleEvent } from "../extensions/types.js";

/**
 * Derives apps/web's existing WorkspaceLifecycleEvent shapes from two
 * successive WorldViewModel snapshots -- the daemon-backed equivalent of
 * useWorkspaceRegistry.ts's own imperative emit() call sites, which fire at
 * a local mutation's own call site and have no equivalent once state
 * arrives as a whole fresh WorldViewModel off onChange instead (see the
 * "replace the mock Workspace catalog" epic, Issue E).
 *
 * Shared World + real concurrency is this epic's own decided baseline: a
 * single onChange frame may legitimately contain more than one other
 * client's change (two Surfaces docked by two different callers between
 * two SSE frames) -- this emits one event per actual change, never assumes
 * at most one.
 *
 * Only maps to the four event shapes WorkspaceLifecycleEvent already
 * declares (workspace:selected/removed, surface:docked/undocked). A newly
 * *created* Workspace that isn't also the newly-active one has no existing
 * shape to map to -- a real, named gap, not silently invented here.
 * surface:docked's `instance.binding` is always omitted: WorldViewModel's
 * SurfaceViewModel has no SurfaceBinding-equivalent field yet (see the
 * scouting Doc's Issue D).
 */
type ReadyWorkspace = Extract<WorldViewModel, { state: "ready" }>["workspaces"][number];
type ReadyWindow = ReadyWorkspace["windows"][number];

/** Dock/undock events for one Window, comparing its previous and next surface lists. */
function diffWindowSurfaces(workspaceId: ReadyWorkspace["id"], window: ReadyWindow, previousWindow: ReadyWindow | undefined): WorkspaceLifecycleEvent[] {
	const events: WorkspaceLifecycleEvent[] = [];
	const previousSurfaceIds = new Set((previousWindow?.surfaces ?? []).map((surface) => surface.id));
	const nextSurfaceIds = new Set(window.surfaces.map((surface) => surface.id));

	for (const surface of window.surfaces) {
		if (previousSurfaceIds.has(surface.id)) continue;
		events.push({ type: "surface:docked", workspaceId, windowId: window.id, instance: { id: surface.id, templateId: surface.integrationId, title: surface.title } });
	}
	for (const surface of previousWindow?.surfaces ?? []) {
		if (nextSurfaceIds.has(surface.id)) continue;
		events.push({ type: "surface:undocked", workspaceId, surfaceInstanceId: surface.id });
	}
	return events;
}

export function diffWorldViewModels(previous: WorldViewModel, next: WorldViewModel): WorkspaceLifecycleEvent[] {
	const events: WorkspaceLifecycleEvent[] = [];
	const previousWorkspaces = previous.state === "ready" ? previous.workspaces : [];
	const nextWorkspaces = next.state === "ready" ? next.workspaces : [];
	const previousById = new Map(previousWorkspaces.map((workspace) => [workspace.id, workspace] as const));
	const previousActiveWorkspaceId = previous.state === "ready" ? previous.activeWorkspaceId : null;

	// A whole Workspace disappearing reports only workspace:removed -- never
	// also a surface:undocked per Surface it took with it, which would be
	// redundant noise a consumer handling workspace:removed doesn't need.
	for (const workspace of previousWorkspaces) {
		if (!nextWorkspaces.some((candidate) => candidate.id === workspace.id)) events.push({ type: "workspace:removed", workspaceId: workspace.id });
	}

	if (next.state === "ready" && next.activeWorkspaceId !== previousActiveWorkspaceId) {
		events.push({ type: "workspace:selected", workspaceId: next.activeWorkspaceId });
	}

	for (const workspace of nextWorkspaces) {
		const previousWorkspace = previousById.get(workspace.id);
		for (const window of workspace.windows) {
			const previousWindow = previousWorkspace?.windows.find((candidate) => candidate.id === window.id);
			events.push(...diffWindowSurfaces(workspace.id, window, previousWindow));
		}
	}

	return events;
}
