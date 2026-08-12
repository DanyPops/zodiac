import {
	type CommandIntent,
	type IntegrationId,
	type ParseResult,
	type Surface,
	type SurfaceId,
	type SurfaceViewModel,
	type WindowViewModel,
	type WorkspaceWindow,
	type Workspace,
	type WorkspaceId,
	type WorkspaceViewModel,
	type World,
	type WorldId,
	type WorldViewModel,
	WorldSchema,
	parseWithSchema,
	surfaceId as makeSurfaceId,
	windowId as makeWindowId,
} from "@zodiac/protocol";
import { createIdSequence, highestIdSuffix } from "./id-sequence.js";

/**
 * The headless, daemon-owned World: creates/updates Workspaces and their
 * docked Surfaces, applies typed CommandIntents through one dispatch path,
 * and projects a semantic view model a renderer (or a test, or no renderer
 * at all) can consume. No React, DOM, or storage import anywhere in this
 * module -- see world/snapshot-port.ts for how a real adapter persists it.
 */
export interface WorldStore {
	readonly id: WorldId;
	snapshot: () => World;
	createWorkspace: (workspaceId: WorkspaceId, title: string) => Workspace;
	getWorkspace: (workspaceId: WorkspaceId) => Workspace | undefined;
	dockSurface: (workspaceId: WorkspaceId, integrationId: IntegrationId, title: string) => Surface;
	undockSurface: (workspaceId: WorkspaceId, surfaceId: SurfaceId) => void;
	/** Applies one typed CommandIntent -- the same path a keybinding, a palette entry, a script/RPC call, or an agent action all go through. */
	apply: (intent: CommandIntent) => void;
	workspaceViewModel: (workspaceId: WorkspaceId) => WorkspaceViewModel | undefined;
	worldViewModel: () => WorldViewModel;
}

function assertNeverIntent(intent: never): never {
	throw new Error(`Unhandled CommandIntent: ${JSON.stringify(intent)}`);
}

function buildStore(worldId: WorldId, initialWorkspaces: ReadonlyMap<WorkspaceId, Workspace>): WorldStore {
	const allWindows = [...initialWorkspaces.values()].flatMap((workspace) => workspace.windows);
	const nextWindowId = createIdSequence("window", highestIdSuffix(allWindows.map((window) => window.id), "window"));
	const nextSurfaceId = createIdSequence(
		"surface",
		highestIdSuffix(
			allWindows.flatMap((window) => window.surfaces.map((surface) => surface.id)),
			"surface",
		),
	);
	const workspaces = new Map(initialWorkspaces);

	function requireWorkspace(workspaceId: WorkspaceId): Workspace {
		const workspace = workspaces.get(workspaceId);
		if (!workspace) throw new Error(`World "${worldId}" has no Workspace "${workspaceId}"`);
		return workspace;
	}

	function createWorkspace(workspaceId: WorkspaceId, title: string): Workspace {
		if (workspaces.has(workspaceId)) throw new Error(`World "${worldId}" already has a Workspace "${workspaceId}"`);
		const window: WorkspaceWindow = { id: makeWindowId(nextWindowId()), title: "Window 0", surfaces: [] };
		const workspace: Workspace = { id: workspaceId, title, windows: [window], activeWindowIndex: 0 };
		workspaces.set(workspaceId, workspace);
		return workspace;
	}

	function dockSurface(workspaceId: WorkspaceId, integrationId: IntegrationId, title: string): Surface {
		const workspace = requireWorkspace(workspaceId);
		const activeWindow = workspace.windows[workspace.activeWindowIndex];
		if (!activeWindow) throw new Error(`Workspace "${workspaceId}" has an out-of-bounds activeWindowIndex ${workspace.activeWindowIndex}`);
		const surface: Surface = { id: makeSurfaceId(nextSurfaceId()), integrationId, title };
		const updatedWindow: WorkspaceWindow = { ...activeWindow, surfaces: [...activeWindow.surfaces, surface] };
		const windows = workspace.windows.map((window, index) => (index === workspace.activeWindowIndex ? updatedWindow : window));
		workspaces.set(workspaceId, { ...workspace, windows });
		return surface;
	}

	function undockSurface(workspaceId: WorkspaceId, surfaceId: SurfaceId): void {
		const workspace = requireWorkspace(workspaceId);
		const windows = workspace.windows.map((window) => ({ ...window, surfaces: window.surfaces.filter((surface) => surface.id !== surfaceId) }));
		workspaces.set(workspaceId, { ...workspace, windows });
	}

	function moveActiveWindow(workspaceId: WorkspaceId, direction: 1 | -1): void {
		const workspace = requireWorkspace(workspaceId);
		const count = workspace.windows.length;
		const activeWindowIndex = (workspace.activeWindowIndex + direction + count) % count;
		workspaces.set(workspaceId, { ...workspace, activeWindowIndex });
	}

	function apply(intent: CommandIntent): void {
		switch (intent.type) {
			case "workspace.create":
				createWorkspace(intent.workspaceId, intent.title);
				return;
			case "surface.dock":
				dockSurface(intent.workspaceId, intent.integrationId, intent.title);
				return;
			case "surface.undock":
				undockSurface(intent.workspaceId, intent.surfaceId);
				return;
			case "window.next":
				moveActiveWindow(intent.workspaceId, 1);
				return;
			case "window.previous":
				moveActiveWindow(intent.workspaceId, -1);
				return;
			default:
				assertNeverIntent(intent);
		}
	}

	function workspaceViewModel(workspaceId: WorkspaceId): WorkspaceViewModel | undefined {
		const workspace = workspaces.get(workspaceId);
		if (!workspace) return undefined;
		const activeWindow = workspace.windows[workspace.activeWindowIndex];
		const windows: WindowViewModel[] = workspace.windows.map((window) => ({
			id: window.id,
			title: window.title,
			active: window.id === activeWindow?.id,
			surfaces: window.surfaces.map(
				(surface): SurfaceViewModel => ({ id: surface.id, integrationId: surface.integrationId, title: surface.title, status: surface.resource?.status ?? "idle", selected: false }),
			),
		}));
		const firstWindow = windows[0];
		if (!firstWindow) return undefined; // a Workspace always has >=1 Window (enforced by WorkspaceSchema); guards the noUncheckedIndexedAccess narrowing below.
		return { id: workspace.id, title: workspace.title, activeWindowId: activeWindow?.id ?? firstWindow.id, windows };
	}

	function worldViewModel(): WorldViewModel {
		const projected = [...workspaces.keys()].map(workspaceViewModel).filter((workspace): workspace is WorkspaceViewModel => workspace !== undefined);
		const first = projected[0];
		return first ? { state: "ready", workspaces: projected, activeWorkspaceId: first.id } : { state: "empty", workspaces: [], activeWorkspaceId: null };
	}

	return {
		id: worldId,
		snapshot: () => ({ id: worldId, workspaces: [...workspaces.values()] }),
		createWorkspace,
		getWorkspace: (workspaceId) => workspaces.get(workspaceId),
		dockSurface,
		undockSurface,
		apply,
		workspaceViewModel,
		worldViewModel,
	};
}

export function createWorldStore(id: WorldId): WorldStore {
	return buildStore(id, new Map());
}

/** Rebuilds a store from an already-schema-validated World -- see hydrateWorldStore for the untrusted-input entry point. */
export function createWorldStoreFromWorld(world: World): WorldStore {
	return buildStore(
		world.id,
		new Map(world.workspaces.map((workspace) => [workspace.id, workspace])),
	);
}

/** The one entry point for loading a World from outside this process's own control (a persisted snapshot, an RPC payload): fails closed with a typed outcome instead of throwing on malformed input. */
export function hydrateWorldStore(input: unknown): ParseResult<WorldStore> {
	const parsed = parseWithSchema(WorldSchema, input);
	if (!parsed.ok) return parsed;
	return { ok: true, value: createWorldStoreFromWorld(parsed.value) };
}
