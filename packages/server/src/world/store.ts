import {
	type CommandId,
	type CommandIntent,
	type IntegrationId,
	type ParseResult,
	type Surface,
	type SurfaceId,
	type SurfaceViewModel,
	type WindowId,
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
import { insertTile, removeTile } from "../window/tile.js";
import type { SurfaceTile, TileFailure } from "../window/tile.js";

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
	/** `requestedSurfaceId` (optional) is a caller-supplied id -- see CommandIntent's own surface.dock.surfaceId. Throws if it collides with a Surface that already exists anywhere in this World, the same throw-on-failure contract as an unknown Workspace. */
	dockSurface: (workspaceId: WorkspaceId, integrationId: IntegrationId, title: string, requestedSurfaceId?: SurfaceId) => Surface;
	undockSurface: (workspaceId: WorkspaceId, surfaceId: SurfaceId) => void;
	/**
	 * Docks into a specific Window instead of dockSurface's always-the-
	 * active-Window default -- the path surface.dock's own optional
	 * CommandIntent.windowId now routes through (see apply()). Returns a
	 * typed outcome instead of throwing: an unknown Workspace or Window id
	 * is a real, expected caller mistake, not a programmer error.
	 */
	/** `requestedSurfaceId` (optional): see dockSurface's own doc comment; a collision reports as a typed DockSurfaceIdCollision failure instead of throwing, consistent with this function's own typed-outcome contract. */
	dockSurfaceInto: (workspaceId: WorkspaceId, integrationId: IntegrationId, title: string, windowId: WindowId, requestedSurfaceId?: SurfaceId) => DockIntoOutcome;
	/** The current tile tree for one Window (see window/tile.ts) -- undefined if the Workspace or Window doesn't exist, null if the Window has no docked Surfaces yet. Web and the TUI project this through window/geometry.ts's computeTileRects; neither recalculates tiling itself. */
	windowTile: (workspaceId: WorkspaceId, windowId: WindowId) => SurfaceTile | null | undefined;
	/**
	 * Applies one typed CommandIntent -- the same path a keybinding, a palette
	 * entry, a script/RPC call, or an agent action all go through. Returns the
	 * submitted intent's own commandId (if any) echoed back, plus whatever new
	 * entity id the command produced (surface.dock's created Surface, today
	 * the only variant that mints one) -- the request/response correlation a
	 * caller needs once more than one caller can be dispatching concurrently.
	 * A caller that ignores the return value (every pre-existing call site)
	 * keeps working unchanged.
	 */
	apply: (intent: CommandIntent) => ApplyOutcome;
	workspaceViewModel: (workspaceId: WorkspaceId) => WorkspaceViewModel | undefined;
	worldViewModel: () => WorldViewModel;
	/**
	 * Subscribes to every successful mutation (createWorkspace/dockSurface/
	 * undockSurface/apply), called with the fresh worldViewModel -- the one
	 * hook a daemon needs to fan a change out to every attached client's
	 * broadcast (SSE) connection. Never fires for a mutation that throws.
	 * Returns an unsubscribe function.
	 */
	onChange: (listener: (viewModel: WorldViewModel) => void) => () => void;
}

function assertNeverIntent(intent: never): never {
	throw new Error(`Unhandled CommandIntent: ${JSON.stringify(intent)}`);
}

/** dockSurfaceInto failed because the named Workspace doesn't exist. */
export interface DockWorkspaceNotFound {
	readonly ok: false;
	readonly reason: "workspace-not-found";
	readonly workspaceId: WorkspaceId;
}
/** dockSurfaceInto failed because the named Window doesn't exist in that Workspace. */
export interface DockWindowNotFound {
	readonly ok: false;
	readonly reason: "window-not-found";
	readonly workspaceId: WorkspaceId;
	readonly windowId: WindowId;
}
/** dockSurfaceInto/dockSurface failed because the caller-supplied surfaceId already names a Surface somewhere in this World -- another concurrent caller may have raced the same id. */
export interface DockSurfaceIdCollision {
	readonly ok: false;
	readonly reason: "surface-id-collision";
	readonly surfaceId: SurfaceId;
}
export type DockIntoFailure = DockWorkspaceNotFound | DockWindowNotFound | DockSurfaceIdCollision | TileFailure;
export type DockIntoOutcome = { readonly ok: true; readonly value: Surface } | DockIntoFailure;

/** apply()'s own return value -- see WorldStore.apply's doc comment. */
export interface ApplyOutcome {
	/** The submitted intent's own commandId, echoed back unchanged; undefined if the caller didn't supply one. */
	readonly commandId?: CommandId;
	/** The id of the Surface surface.dock just created; absent for every other intent type. */
	readonly surfaceId?: SurfaceId;
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
	const changeListeners = new Set<(viewModel: WorldViewModel) => void>();

	/**
	 * One tile tree per Window, live/derived state kept in lockstep with each
	 * Window's own `surfaces` array (the persisted wire-schema source of
	 * truth) -- never itself persisted or schema-validated. Rebuilt from
	 * `surfaces` below for a rehydrated World; window ids are unique across
	 * this store's whole lifetime (minted from one shared id sequence), so a
	 * flat map keyed by WindowId alone is safe without a (workspaceId,
	 * windowId) composite key.
	 */
	const tileByWindow = new Map<WindowId, SurfaceTile | null>();
	for (const workspace of initialWorkspaces.values()) {
		for (const window of workspace.windows) {
			let tile: SurfaceTile | null = null;
			for (const surface of window.surfaces) {
				const inserted = insertTile(tile, surface.id);
				if (inserted.ok) {
					tile = inserted.value;
				} else {
					// A persisted Window may carry up to protocol's own
					// MAX_SURFACES_PER_WINDOW (128), looser than this tile tree's
					// own MAX_SURFACES_PER_TILE/MAX_CHILDREN_PER_TILE bounds -- a
					// known, narrow mismatch between the wire schema and the tile
					// tree's own bounds. Degrade gracefully on rehydration (skip
					// the surface that doesn't fit, keep the store usable) rather
					// than crash a whole daemon startup over one oversized Window.
					console.error(`World "${worldId}": Window "${window.id}" has more docked Surfaces than the tile tree can represent (${inserted.reason}); Surface "${surface.id}" is excluded from its tile tree (still present in the Window's own surfaces list).`);
				}
			}
			tileByWindow.set(window.id, tile);
		}
	}

	function emitChange(): void {
		const viewModel = worldViewModel();
		for (const listener of changeListeners) listener(viewModel);
	}

	function requireWorkspace(workspaceId: WorkspaceId): Workspace {
		const workspace = workspaces.get(workspaceId);
		if (!workspace) throw new Error(`World "${worldId}" has no Workspace "${workspaceId}"`);
		return workspace;
	}

	function createWorkspace(workspaceId: WorkspaceId, title: string): Workspace {
		if (workspaces.has(workspaceId)) throw new Error(`World "${worldId}" already has a Workspace "${workspaceId}"`);
		const window: WorkspaceWindow = { id: makeWindowId(nextWindowId()), title: "Window 0", surfaces: [] };
		tileByWindow.set(window.id, null);
		const workspace: Workspace = { id: workspaceId, title, windows: [window], activeWindowIndex: 0 };
		workspaces.set(workspaceId, workspace);
		emitChange();
		return workspace;
	}

	function surfaceIdInUse(candidate: SurfaceId): boolean {
		for (const workspace of workspaces.values()) {
			for (const window of workspace.windows) {
				if (window.surfaces.some((surface) => surface.id === candidate)) return true;
			}
		}
		return false;
	}

	function dockSurface(workspaceId: WorkspaceId, integrationId: IntegrationId, title: string, requestedSurfaceId?: SurfaceId): Surface {
		const workspace = requireWorkspace(workspaceId);
		const activeWindow = workspace.windows[workspace.activeWindowIndex];
		if (!activeWindow) throw new Error(`Workspace "${workspaceId}" has an out-of-bounds activeWindowIndex ${workspace.activeWindowIndex}`);
		if (requestedSurfaceId !== undefined && surfaceIdInUse(requestedSurfaceId)) throw new Error(`Cannot dock Surface "${requestedSurfaceId}" into World "${worldId}": surface-id-collision`);
		const surface: Surface = { id: requestedSurfaceId ?? makeSurfaceId(nextSurfaceId()), integrationId, title };
		const inserted = insertTile(tileByWindow.get(activeWindow.id) ?? null, surface.id);
		if (!inserted.ok) throw new Error(`Cannot dock Surface "${surface.id}" into Window "${activeWindow.id}": ${inserted.reason}`);
		const updatedWindow: WorkspaceWindow = { ...activeWindow, surfaces: [...activeWindow.surfaces, surface] };
		const windows = workspace.windows.map((window, index) => (index === workspace.activeWindowIndex ? updatedWindow : window));
		workspaces.set(workspaceId, { ...workspace, windows });
		tileByWindow.set(activeWindow.id, inserted.value);
		emitChange();
		return surface;
	}

	/** The typed-outcome sibling of dockSurface, docking into a caller-named Window instead of always the active one -- see WorldStore.dockSurfaceInto's own doc comment. */
	function dockSurfaceInto(workspaceId: WorkspaceId, integrationId: IntegrationId, title: string, targetWindowId: WindowId, requestedSurfaceId?: SurfaceId): DockIntoOutcome {
		const workspace = workspaces.get(workspaceId);
		if (!workspace) return { ok: false, reason: "workspace-not-found", workspaceId };
		const targetWindow = workspace.windows.find((window) => window.id === targetWindowId);
		if (!targetWindow) return { ok: false, reason: "window-not-found", workspaceId, windowId: targetWindowId };
		if (requestedSurfaceId !== undefined && surfaceIdInUse(requestedSurfaceId)) return { ok: false, reason: "surface-id-collision", surfaceId: requestedSurfaceId };

		const surface: Surface = { id: requestedSurfaceId ?? makeSurfaceId(nextSurfaceId()), integrationId, title };
		const inserted = insertTile(tileByWindow.get(targetWindowId) ?? null, surface.id);
		if (!inserted.ok) return inserted;

		const updatedWindow: WorkspaceWindow = { ...targetWindow, surfaces: [...targetWindow.surfaces, surface] };
		const windows = workspace.windows.map((window) => (window.id === targetWindowId ? updatedWindow : window));
		workspaces.set(workspaceId, { ...workspace, windows });
		tileByWindow.set(targetWindowId, inserted.value);
		emitChange();
		return { ok: true, value: surface };
	}

	function undockSurface(workspaceId: WorkspaceId, surfaceId: SurfaceId): void {
		const workspace = requireWorkspace(workspaceId);
		const windows = workspace.windows.map((window) => {
			if (!window.surfaces.some((surface) => surface.id === surfaceId)) return window;
			const removed = removeTile(tileByWindow.get(window.id) ?? null, surfaceId);
			if (removed.ok) tileByWindow.set(window.id, removed.value);
			return { ...window, surfaces: window.surfaces.filter((surface) => surface.id !== surfaceId) };
		});
		workspaces.set(workspaceId, { ...workspace, windows });
		emitChange();
	}

	function windowTile(workspaceId: WorkspaceId, targetWindowId: WindowId): SurfaceTile | null | undefined {
		const workspace = workspaces.get(workspaceId);
		if (!workspace) return undefined;
		if (!workspace.windows.some((window) => window.id === targetWindowId)) return undefined;
		return tileByWindow.get(targetWindowId) ?? null;
	}

	function moveActiveWindow(workspaceId: WorkspaceId, direction: 1 | -1): void {
		const workspace = requireWorkspace(workspaceId);
		const count = workspace.windows.length;
		const activeWindowIndex = (workspace.activeWindowIndex + direction + count) % count;
		workspaces.set(workspaceId, { ...workspace, activeWindowIndex });
	}

	function apply(intent: CommandIntent): ApplyOutcome {
		switch (intent.type) {
			case "workspace.create":
				createWorkspace(intent.workspaceId, intent.title);
				return { commandId: intent.commandId };
			case "surface.dock": {
				if (intent.windowId !== undefined) {
					const result = dockSurfaceInto(intent.workspaceId, intent.integrationId, intent.title, intent.windowId, intent.surfaceId);
					if (!result.ok) throw new Error(`Cannot dock into Window "${intent.windowId}": ${result.reason}`);
					return { commandId: intent.commandId, surfaceId: result.value.id };
				}
				const surface = dockSurface(intent.workspaceId, intent.integrationId, intent.title, intent.surfaceId);
				return { commandId: intent.commandId, surfaceId: surface.id };
			}
			case "surface.undock":
				undockSurface(intent.workspaceId, intent.surfaceId);
				return { commandId: intent.commandId };
			case "window.next":
				moveActiveWindow(intent.workspaceId, 1);
				emitChange();
				return { commandId: intent.commandId };
			case "window.previous":
				moveActiveWindow(intent.workspaceId, -1);
				emitChange();
				return { commandId: intent.commandId };
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
			tile: tileByWindow.get(window.id) ?? null,
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
		dockSurfaceInto,
		windowTile,
		apply,
		workspaceViewModel,
		worldViewModel,
		onChange: (listener) => {
			changeListeners.add(listener);
			return () => changeListeners.delete(listener);
		},
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
