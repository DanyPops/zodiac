import {
	type AppletDefinition,
	type AppletId,
	type CommandId,
	type CommandIntent,
	type ContributionOutcome,
	type IntegrationDefinition,
	type IntegrationId,
	type Panel,
	type PanelId,
	type ParseResult,
	type Surface,
	type SurfaceId,
	type SurfaceViewModel,
	type Vertical,
	type WindowId,
	type WindowViewModel,
	type WorkspaceWindow,
	type Workspace,
	type WorkspaceId,
	type WorkspaceViewModel,
	type World,
	type WorldChange,
	type WorldId,
	type WorldViewModel,
	formFactorForLocation,
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
	/** Opens a bounded Vertical atomically as one new Workspace with one Surface per renderable Integration. */
	openVertical: (workspaceId: WorkspaceId, vertical: Vertical) => OpenVerticalOutcome;
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
	/** Moves one existing Surface by changing its authoritative windowId and both Windows' derived tile geometry in one notification transaction. Identity and every non-placement field are preserved. */
	moveSurfaceToWindow: (workspaceId: WorkspaceId, surfaceId: SurfaceId, targetWindowId: WindowId) => MoveSurfaceOutcome;
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
	/**
	 * Registers the handler that `apply()` routes an `integration.invoke`
	 * CommandIntent to for this `integrationId`. Exactly one handler per
	 * `integrationId` at a time -- a second registration for the same id
	 * throws (the same "registration is exclusive" contract as
	 * ContributionHost.registerCommand/registerResourceProvider in
	 * @zodiac/protocol). Returns an unregister function. `apply()` throws
	 * a clear "no registered handler" error for an `integration.invoke`
	 * naming an `integrationId` nothing has registered -- fail loud, per
	 * Raymond's Rule of Repair, rather than silently drop the command.
	 */
	registerIntegrationInvokeHandler: (integrationId: IntegrationId, handler: IntegrationInvokeHandler) => () => void;
	/** Global World chrome, not owned by any one Workspace -- see panel.move's own CommandIntent doc comment. Empty unless seeded via createWorldStore's own options. */
	panels: () => readonly Panel[];
	workspaceViewModel: (workspaceId: WorkspaceId) => WorkspaceViewModel | undefined;
	worldViewModel: () => WorldViewModel;
	/**
	 * Subscribes to every successful mutation (createWorkspace/dockSurface/
	 * undockSurface/apply), called with the fresh worldViewModel -- the one
	 * hook a daemon needs to fan a change out to every attached client's
	 * broadcast (SSE) connection. Never fires for a mutation that throws.
	 * Returns an unsubscribe function.
	 */
	onChange: (listener: (change: WorldChange) => void) => () => void;
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

export interface MoveSurfaceNotFound {
	readonly ok: false;
	readonly reason: "surface-not-found";
	readonly workspaceId: WorkspaceId;
	readonly surfaceId: SurfaceId;
}
export interface MoveSurfaceSourceTileOutOfSync {
	readonly ok: false;
	readonly reason: "source-tile-out-of-sync";
	readonly workspaceId: WorkspaceId;
	readonly windowId: WindowId;
	readonly surfaceId: SurfaceId;
}
export type MoveSurfaceFailure = DockWorkspaceNotFound | DockWindowNotFound | MoveSurfaceNotFound | MoveSurfaceSourceTileOutOfSync | TileFailure;
export type MoveSurfaceOutcome = { readonly ok: true; readonly moved: boolean; readonly value: Surface } | MoveSurfaceFailure;

export interface OpenVerticalWorkspaceIdCollision {
	readonly ok: false;
	readonly reason: "workspace-id-collision";
	readonly workspaceId: WorkspaceId;
}
export interface OpenVerticalIntegrationNotFound {
	readonly ok: false;
	readonly reason: "integration-not-found";
	readonly integrationId: IntegrationId;
}
export interface OpenVerticalIntegrationNotRenderable {
	readonly ok: false;
	readonly reason: "integration-not-renderable";
	readonly integrationId: IntegrationId;
}
export type OpenVerticalFailure = OpenVerticalWorkspaceIdCollision | OpenVerticalIntegrationNotFound | OpenVerticalIntegrationNotRenderable | TileFailure;
export type OpenVerticalOutcome = { readonly ok: true; readonly value: Workspace } | OpenVerticalFailure;

/** Constructor-time domain resolvers plus Panel state. Panels remain global rather than per-Workspace; `getApplet` validates panel placement, while `getIntegration` validates Vertical bundles before any Workspace mutation. */
export interface WorldStorePanelOptions {
	readonly panels?: readonly Panel[];
	readonly getApplet?: (id: AppletId) => AppletDefinition | undefined;
	/** Resolves the domain definition a Vertical must validate before creating its Surface bundle. */
	readonly getIntegration?: (id: IntegrationId) => IntegrationDefinition | undefined;
}

/**
 * A registered Integration's own handler for `integration.invoke` -- the
 * dispatcher (`apply()`) routes by `integrationId` alone and never inspects
 * `action`/`input` itself; the target Integration owns and validates its own
 * action vocabulary and input shape (see CommandIntentSchema's own doc
 * comment for the full "Composability over specificity" rationale).
 * Deliberately synchronous: this task defines the generic command's shape
 * and in-process routing, not the real Vehicle-backed process/trust
 * boundary for where an Integration's execute actually runs (a separate,
 * not-yet-built task) -- a future async out-of-process handler is expected
 * to land as part of that boundary, not here.
 *
 * The optional third parameter carries a caller-presented approval
 * capability (CommandIntent's own `approvalCapability` field) separately
 * from `input` -- mirrors Vehicle's own `enforceGate(..., presentedCapability)`
 * split. Every pre-existing two-parameter handler (every fixture in this
 * package's own tests) stays valid: a function typed to ignore its third
 * parameter is assignable wherever this three-parameter shape is expected.
 * See packages/server/src/approval/gated-integration-invoke.ts for the
 * gating wrapper that actually reads it.
 */
export type IntegrationInvokeHandler = (action: string, input: unknown, context?: IntegrationInvokeContext) => ContributionOutcome<unknown>;

/** See IntegrationInvokeHandler's own doc comment. */
export interface IntegrationInvokeContext {
	readonly presentedCapability?: string;
}

/** apply()'s own return value -- see WorldStore.apply's doc comment. */
export interface ApplyOutcome {
	/** The submitted intent's own commandId, echoed back unchanged; undefined if the caller didn't supply one. */
	readonly commandId?: CommandId;
	/** The id of the Surface surface.dock just created; absent for every other intent type. */
	readonly surfaceId?: SurfaceId;
	/** The registered IntegrationInvokeHandler's own returned outcome for integration.invoke; absent for every other intent type. */
	readonly invokeResult?: ContributionOutcome<unknown>;
}

function buildStore(worldId: WorldId, initialWorkspaces: ReadonlyMap<WorkspaceId, Workspace>, panelOptions: WorldStorePanelOptions = {}): WorldStore {
	const allWindows = [...initialWorkspaces.values()].flatMap((workspace) => workspace.windows);
	const allSurfaces = [...initialWorkspaces.values()].flatMap((workspace) => workspace.surfaces);
	const nextWindowId = createIdSequence("window", highestIdSuffix(allWindows.map((window) => window.id), "window"));
	const nextSurfaceId = createIdSequence("surface", highestIdSuffix(allSurfaces.map((surface) => surface.id), "surface"));
	const workspaces = new Map(initialWorkspaces);
	/** Derived O(1) lookup for Surface-centric commands; Workspace.surfaces remains the persisted registry and Surface.windowId remains placement authority. */
	const surfaceById = new Map<SurfaceId, { readonly workspaceId: WorkspaceId; readonly surface: Surface }>();
	for (const workspace of initialWorkspaces.values()) {
		for (const surface of workspace.surfaces) surfaceById.set(surface.id, { workspaceId: workspace.id, surface });
	}
	const changeListeners = new Set<(change: WorldChange) => void>();
	// Explicit selection state -- distinct from worldViewModel's old
	// "always the first created Workspace" fallback, which had no real
	// selection concept at all (there was no workspace.select intent yet).
	// Defaults to the first Workspace this store already holds (preserving
	// prior behavior for a store seeded with existing Workspaces); becomes
	// null only once every Workspace is removed.
	let activeWorkspaceId: WorkspaceId | null = [...initialWorkspaces.keys()][0] ?? null;
	const panels = new Map((panelOptions.panels ?? []).map((panel) => [panel.id, panel]));
	const getApplet = panelOptions.getApplet ?? (() => undefined);
	const getIntegration = panelOptions.getIntegration ?? (() => undefined);
	const integrationInvokeHandlers = new Map<IntegrationId, IntegrationInvokeHandler>();

	function registerIntegrationInvokeHandler(targetIntegrationId: IntegrationId, handler: IntegrationInvokeHandler): () => void {
		if (integrationInvokeHandlers.has(targetIntegrationId)) throw new Error(`World "${worldId}" already has an integration.invoke handler registered for Integration "${targetIntegrationId}"`);
		integrationInvokeHandlers.set(targetIntegrationId, handler);
		return () => {
			if (integrationInvokeHandlers.get(targetIntegrationId) === handler) integrationInvokeHandlers.delete(targetIntegrationId);
		};
	}

	/**
	 * One tile tree per Window, live/derived state rebuilt from the Workspace's
	 * authoritative Surface registry (`Surface.windowId`). It owns geometry and
	 * order only; it is never a second membership authority or persisted wire
	 * shape. Window ids are unique across this store's whole lifetime (minted
	 * from one shared id sequence), so a flat map keyed by WindowId alone is
	 * safe without a (workspaceId, windowId) composite key.
	 */
	const tileByWindow = new Map<WindowId, SurfaceTile | null>();
	for (const workspace of initialWorkspaces.values()) {
		for (const window of workspace.windows) {
			let tile: SurfaceTile | null = null;
			for (const surface of workspace.surfaces.filter((candidate) => candidate.windowId === window.id)) {
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
					console.error(`World "${worldId}": Window "${window.id}" has more docked Surfaces than the tile tree can represent (${inserted.reason}); Surface "${surface.id}" is excluded from its tile tree (still present in the Workspace Surface registry).`);
				}
			}
			tileByWindow.set(window.id, tile);
		}
	}

	function emitChange(commandId?: CommandId): void {
		const change: WorldChange = { viewModel: worldViewModel(), ...(commandId !== undefined ? { commandId } : {}) };
		for (const listener of changeListeners) listener(change);
	}

	function requireWorkspace(workspaceId: WorkspaceId): Workspace {
		const workspace = workspaces.get(workspaceId);
		if (!workspace) throw new Error(`World "${worldId}" has no Workspace "${workspaceId}"`);
		return workspace;
	}

	/** `activate`: explicit opt-in (see CommandIntentSchema's own doc comment on workspace.create) -- the first-ever Workspace in a World's lifetime always auto-activates regardless, matching worldViewModel's own longstanding "first created" fallback; every later create only activates if the caller asks. */
	function createWorkspace(workspaceId: WorkspaceId, title: string, acknowledgedCommandId?: CommandId, activate?: boolean): Workspace {
		if (workspaces.has(workspaceId)) throw new Error(`World "${worldId}" already has a Workspace "${workspaceId}"`);
		const window: WorkspaceWindow = { id: makeWindowId(nextWindowId()), title: "Window 0" };
		tileByWindow.set(window.id, null);
		const workspace: Workspace = { id: workspaceId, title, windows: [window], surfaces: [], activeWindowIndex: 0 };
		workspaces.set(workspaceId, workspace);
		if (activeWorkspaceId === null || activate) activeWorkspaceId = workspaceId;
		emitChange(acknowledgedCommandId);
		return workspace;
	}

	function surfaceIdInUse(candidate: SurfaceId): boolean {
		return surfaceById.has(candidate);
	}

	function openVertical(workspaceId: WorkspaceId, vertical: Vertical): OpenVerticalOutcome {
		if (workspaces.has(workspaceId)) return { ok: false, reason: "workspace-id-collision", workspaceId };

		const definitions: IntegrationDefinition[] = [];
		for (const integrationId of vertical.integrationIds) {
			const definition = getIntegration(integrationId);
			if (!definition) return { ok: false, reason: "integration-not-found", integrationId };
			if (!definition.capabilities.renderable) return { ok: false, reason: "integration-not-renderable", integrationId };
			definitions.push(definition);
		}

		const window: WorkspaceWindow = { id: makeWindowId(nextWindowId()), title: "Window 0" };
		const surfaces: Surface[] = definitions.map((definition) => ({
			id: makeSurfaceId(nextSurfaceId()),
			windowId: window.id,
			integrationId: definition.id,
			title: definition.title,
		}));
		let tile: SurfaceTile | null = null;
		for (const surface of surfaces) {
			const inserted = insertTile(tile, surface.id);
			if (!inserted.ok) return inserted;
			tile = inserted.value;
		}

		const workspace: Workspace = { id: workspaceId, title: vertical.name, windows: [window], surfaces, activeWindowIndex: 0 };
		workspaces.set(workspaceId, workspace);
		for (const surface of surfaces) surfaceById.set(surface.id, { workspaceId, surface });
		tileByWindow.set(window.id, tile);
		if (activeWorkspaceId === null) activeWorkspaceId = workspaceId;
		emitChange();
		return { ok: true, value: workspace };
	}

	function dockSurface(workspaceId: WorkspaceId, integrationId: IntegrationId, title: string, requestedSurfaceId?: SurfaceId, acknowledgedCommandId?: CommandId): Surface {
		const workspace = requireWorkspace(workspaceId);
		const activeWindow = workspace.windows[workspace.activeWindowIndex];
		if (!activeWindow) throw new Error(`Workspace "${workspaceId}" has an out-of-bounds activeWindowIndex ${workspace.activeWindowIndex}`);
		if (requestedSurfaceId !== undefined && surfaceIdInUse(requestedSurfaceId)) throw new Error(`Cannot dock Surface "${requestedSurfaceId}" into World "${worldId}": surface-id-collision`);
		const surface: Surface = { id: requestedSurfaceId ?? makeSurfaceId(nextSurfaceId()), windowId: activeWindow.id, integrationId, title };
		const inserted = insertTile(tileByWindow.get(activeWindow.id) ?? null, surface.id);
		if (!inserted.ok) throw new Error(`Cannot dock Surface "${surface.id}" into Window "${activeWindow.id}": ${inserted.reason}`);
		workspaces.set(workspaceId, { ...workspace, surfaces: [...workspace.surfaces, surface] });
		surfaceById.set(surface.id, { workspaceId, surface });
		tileByWindow.set(activeWindow.id, inserted.value);
		emitChange(acknowledgedCommandId);
		return surface;
	}

	/** The typed-outcome sibling of dockSurface, docking into a caller-named Window instead of always the active one -- see WorldStore.dockSurfaceInto's own doc comment. */
	function dockSurfaceInto(workspaceId: WorkspaceId, integrationId: IntegrationId, title: string, targetWindowId: WindowId, requestedSurfaceId?: SurfaceId, acknowledgedCommandId?: CommandId): DockIntoOutcome {
		const workspace = workspaces.get(workspaceId);
		if (!workspace) return { ok: false, reason: "workspace-not-found", workspaceId };
		const targetWindow = workspace.windows.find((window) => window.id === targetWindowId);
		if (!targetWindow) return { ok: false, reason: "window-not-found", workspaceId, windowId: targetWindowId };
		if (requestedSurfaceId !== undefined && surfaceIdInUse(requestedSurfaceId)) return { ok: false, reason: "surface-id-collision", surfaceId: requestedSurfaceId };

		const surface: Surface = { id: requestedSurfaceId ?? makeSurfaceId(nextSurfaceId()), windowId: targetWindow.id, integrationId, title };
		const inserted = insertTile(tileByWindow.get(targetWindowId) ?? null, surface.id);
		if (!inserted.ok) return inserted;

		workspaces.set(workspaceId, { ...workspace, surfaces: [...workspace.surfaces, surface] });
		surfaceById.set(surface.id, { workspaceId, surface });
		tileByWindow.set(targetWindowId, inserted.value);
		emitChange(acknowledgedCommandId);
		return { ok: true, value: surface };
	}

	function undockSurface(workspaceId: WorkspaceId, surfaceId: SurfaceId, acknowledgedCommandId?: CommandId): void {
		const workspace = requireWorkspace(workspaceId);
		const indexed = surfaceById.get(surfaceId);
		const surface = indexed?.workspaceId === workspaceId ? indexed.surface : undefined;
		if (surface) {
			const removed = removeTile(tileByWindow.get(surface.windowId) ?? null, surfaceId);
			if (removed.ok) tileByWindow.set(surface.windowId, removed.value);
			surfaceById.delete(surfaceId);
		}
		workspaces.set(workspaceId, { ...workspace, surfaces: workspace.surfaces.filter((candidate) => candidate.id !== surfaceId) });
		emitChange(acknowledgedCommandId);
	}

	function moveSurfaceToWindow(workspaceId: WorkspaceId, surfaceId: SurfaceId, targetWindowId: WindowId): MoveSurfaceOutcome {
		const workspace = workspaces.get(workspaceId);
		if (!workspace) return { ok: false, reason: "workspace-not-found", workspaceId };
		const indexed = surfaceById.get(surfaceId);
		if (!indexed || indexed.workspaceId !== workspaceId) return { ok: false, reason: "surface-not-found", workspaceId, surfaceId };
		const targetWindow = workspace.windows.find((window) => window.id === targetWindowId);
		if (!targetWindow) return { ok: false, reason: "window-not-found", workspaceId, windowId: targetWindowId };
		const surface = indexed.surface;
		if (surface.windowId === targetWindowId) return { ok: true, moved: false, value: surface };

		// Both tile operations are pure. Compute both results before changing
		// any registry/index/tile state so every typed failure is atomic.
		const inserted = insertTile(tileByWindow.get(targetWindowId) ?? null, surfaceId);
		if (!inserted.ok) return inserted;
		const removed = removeTile(tileByWindow.get(surface.windowId) ?? null, surfaceId);
		if (!removed.ok) return { ok: false, reason: "source-tile-out-of-sync", workspaceId, windowId: surface.windowId, surfaceId };

		const movedSurface: Surface = { ...surface, windowId: targetWindowId };
		workspaces.set(workspaceId, {
			...workspace,
			surfaces: workspace.surfaces.map((candidate) => (candidate.id === surfaceId ? movedSurface : candidate)),
		});
		surfaceById.set(surfaceId, { workspaceId, surface: movedSurface });
		tileByWindow.set(surface.windowId, removed.value);
		tileByWindow.set(targetWindowId, inserted.value);
		emitChange();
		return { ok: true, moved: true, value: movedSurface };
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

	function renameWorkspace(workspaceId: WorkspaceId, title: string, acknowledgedCommandId?: CommandId): void {
		const workspace = requireWorkspace(workspaceId);
		workspaces.set(workspaceId, { ...workspace, title });
		emitChange(acknowledgedCommandId);
	}

	/** Drops a Workspace and every Window/Surface it owns. If it was the active one, falls back to another remaining Workspace (insertion order), or null once none remain -- the same "no Workspace is authoritatively active" state a fresh, empty World starts in. */
	function removeWorkspace(workspaceId: WorkspaceId, acknowledgedCommandId?: CommandId): void {
		const workspace = requireWorkspace(workspaceId);
		for (const surface of workspace.surfaces) surfaceById.delete(surface.id);
		for (const window of workspace.windows) tileByWindow.delete(window.id);
		workspaces.delete(workspaceId);
		if (activeWorkspaceId === workspaceId) activeWorkspaceId = [...workspaces.keys()][0] ?? null;
		emitChange(acknowledgedCommandId);
	}

	function selectWorkspace(workspaceId: WorkspaceId, acknowledgedCommandId?: CommandId): void {
		requireWorkspace(workspaceId);
		activeWorkspaceId = workspaceId;
		emitChange(acknowledgedCommandId);
	}

	function selectWindow(workspaceId: WorkspaceId, targetWindowId: WindowId, acknowledgedCommandId?: CommandId): void {
		const workspace = requireWorkspace(workspaceId);
		const index = workspace.windows.findIndex((window) => window.id === targetWindowId);
		if (index < 0) throw new Error(`Workspace "${workspaceId}" has no Window "${targetWindowId}"`);
		workspaces.set(workspaceId, { ...workspace, activeWindowIndex: index });
		emitChange(acknowledgedCommandId);
	}

	/** Appends a new, empty Window at the end and makes it active -- mirrors model.ts's own addWindow. Not the ephemeral, auto-pruned kind window.scroll's own CommandIntent doc comment describes; that behavior isn't ported to the daemon domain model yet. */
	function addWindow(workspaceId: WorkspaceId, acknowledgedCommandId?: CommandId): void {
		const workspace = requireWorkspace(workspaceId);
		const window: WorkspaceWindow = { id: makeWindowId(nextWindowId()), title: `Window ${workspace.windows.length}` };
		tileByWindow.set(window.id, null);
		workspaces.set(workspaceId, { ...workspace, windows: [...workspace.windows, window], activeWindowIndex: workspace.windows.length });
		emitChange(acknowledgedCommandId);
	}

	function renameWindow(workspaceId: WorkspaceId, targetWindowId: WindowId, title: string, acknowledgedCommandId?: CommandId): void {
		const workspace = requireWorkspace(workspaceId);
		if (!workspace.windows.some((window) => window.id === targetWindowId)) throw new Error(`Workspace "${workspaceId}" has no Window "${targetWindowId}"`);
		workspaces.set(workspaceId, { ...workspace, windows: workspace.windows.map((window) => (window.id === targetWindowId ? { ...window, title } : window)) });
		emitChange(acknowledgedCommandId);
	}

	function movePanel(targetPanelId: PanelId, placement: Extract<CommandIntent, { type: "panel.move" }>["placement"], acknowledgedCommandId?: CommandId): void {
		const panel = panels.get(targetPanelId);
		if (!panel) throw new Error(`World "${worldId}" has no Panel "${targetPanelId}"`);
		const formFactor = formFactorForLocation(placement.location);
		const assignedAppletIds = [panel.startCap, panel.endCap, ...panel.body].filter((id): id is AppletId => id !== null);
		for (const assignedAppletId of assignedAppletIds) {
			const applet = getApplet(assignedAppletId);
			if (applet && !applet.supportedFormFactors.has(formFactor)) throw new Error(`Cannot move Panel "${targetPanelId}" to Location "${placement.location}": Applet "${assignedAppletId}" does not support FormFactor "${formFactor}"`);
		}
		panels.set(targetPanelId, { ...panel, location: placement.location, alignment: placement.alignment, offset: placement.offset });
		emitChange(acknowledgedCommandId);
	}

	/** Never touches thicknessUnit -- a resize only ever changes magnitude, never which unit space it's declared in. See PanelThicknessUnit's own doc comment (panel.ts): a caller resizing a Panel outside its own unit space is a caller bug this function doesn't police. */
	function resizePanel(targetPanelId: PanelId, thickness: number, acknowledgedCommandId?: CommandId): void {
		const panel = panels.get(targetPanelId);
		if (!panel) throw new Error(`World "${worldId}" has no Panel "${targetPanelId}"`);
		panels.set(targetPanelId, { ...panel, thickness });
		emitChange(acknowledgedCommandId);
	}

	function apply(intent: CommandIntent): ApplyOutcome {
		switch (intent.type) {
			case "workspace.create":
				createWorkspace(intent.workspaceId, intent.title, intent.commandId, intent.activate);
				return { commandId: intent.commandId };
			case "surface.dock": {
				if (intent.windowId !== undefined) {
					const result = dockSurfaceInto(intent.workspaceId, intent.integrationId, intent.title, intent.windowId, intent.surfaceId, intent.commandId);
					if (!result.ok) throw new Error(`Cannot dock into Window "${intent.windowId}": ${result.reason}`);
					return { commandId: intent.commandId, surfaceId: result.value.id };
				}
				const surface = dockSurface(intent.workspaceId, intent.integrationId, intent.title, intent.surfaceId, intent.commandId);
				return { commandId: intent.commandId, surfaceId: surface.id };
			}
			case "surface.undock":
				undockSurface(intent.workspaceId, intent.surfaceId, intent.commandId);
				return { commandId: intent.commandId };
			case "window.next":
				moveActiveWindow(intent.workspaceId, 1);
				emitChange(intent.commandId);
				return { commandId: intent.commandId };
			case "window.previous":
				moveActiveWindow(intent.workspaceId, -1);
				emitChange(intent.commandId);
				return { commandId: intent.commandId };
			case "workspace.rename":
				renameWorkspace(intent.workspaceId, intent.title, intent.commandId);
				return { commandId: intent.commandId };
			case "workspace.remove":
				removeWorkspace(intent.workspaceId, intent.commandId);
				return { commandId: intent.commandId };
			case "workspace.select":
				selectWorkspace(intent.workspaceId, intent.commandId);
				return { commandId: intent.commandId };
			case "window.select":
				selectWindow(intent.workspaceId, intent.windowId, intent.commandId);
				return { commandId: intent.commandId };
			case "window.add":
				addWindow(intent.workspaceId, intent.commandId);
				return { commandId: intent.commandId };
			case "window.scroll":
				moveActiveWindow(intent.workspaceId, intent.direction);
				emitChange(intent.commandId);
				return { commandId: intent.commandId };
			case "window.rename":
				renameWindow(intent.workspaceId, intent.windowId, intent.title, intent.commandId);
				return { commandId: intent.commandId };
			case "panel.move":
				movePanel(intent.panelId, intent.placement, intent.commandId);
				return { commandId: intent.commandId };
			case "panel.resize":
				resizePanel(intent.panelId, intent.thickness, intent.commandId);
				return { commandId: intent.commandId };
			case "integration.invoke": {
				requireWorkspace(intent.workspaceId);
				const handler = integrationInvokeHandlers.get(intent.integrationId);
				if (!handler) throw new Error(`World "${worldId}" has no registered integration.invoke handler for Integration "${intent.integrationId}"`);
				const invokeResult = handler(intent.action, intent.input, { presentedCapability: intent.approvalCapability });
				emitChange(intent.commandId);
				return { commandId: intent.commandId, invokeResult };
			}
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
			surfaces: workspace.surfaces
				.filter((surface) => surface.windowId === window.id)
				.map((surface): SurfaceViewModel => ({ id: surface.id, integrationId: surface.integrationId, title: surface.title, status: surface.resource?.status ?? "idle", selected: false })),
			tile: tileByWindow.get(window.id) ?? null,
		}));
		const firstWindow = windows[0];
		if (!firstWindow) return undefined; // a Workspace always has >=1 Window (enforced by WorkspaceSchema); guards the noUncheckedIndexedAccess narrowing below.
		const activeIntegrationIds: IntegrationId[] = [];
		for (const surface of workspace.surfaces) {
			if (!activeIntegrationIds.includes(surface.integrationId)) activeIntegrationIds.push(surface.integrationId);
		}
		return { id: workspace.id, title: workspace.title, activeWindowId: activeWindow?.id ?? firstWindow.id, windows, activeIntegrationIds };
	}

	function worldViewModel(): WorldViewModel {
		const projected = [...workspaces.keys()].map(workspaceViewModel).filter((workspace): workspace is WorkspaceViewModel => workspace !== undefined);
		const first = projected[0];
		if (!first) return { state: "empty", workspaces: [], activeWorkspaceId: null };
		// activeWorkspaceId may be stale only if something bypassed removeWorkspace's own cleanup -- fall back to the first projected Workspace rather than project a dangling id.
		const resolvedActiveId = activeWorkspaceId !== null && projected.some((workspace) => workspace.id === activeWorkspaceId) ? activeWorkspaceId : first.id;
		return { state: "ready", workspaces: projected, activeWorkspaceId: resolvedActiveId };
	}

	return {
		id: worldId,
		snapshot: () => ({ id: worldId, workspaces: [...workspaces.values()] }),
		createWorkspace,
		openVertical,
		getWorkspace: (workspaceId) => workspaces.get(workspaceId),
		dockSurface,
		undockSurface,
		dockSurfaceInto,
		moveSurfaceToWindow,
		windowTile,
		apply,
		registerIntegrationInvokeHandler,
		panels: () => [...panels.values()],
		workspaceViewModel,
		worldViewModel,
		onChange: (listener) => {
			changeListeners.add(listener);
			return () => changeListeners.delete(listener);
		},
	};
}

export function createWorldStore(id: WorldId, panelOptions?: WorldStorePanelOptions): WorldStore {
	return buildStore(id, new Map(), panelOptions);
}

/** Rebuilds a store from an already-schema-validated World -- see hydrateWorldStore for the untrusted-input entry point. */
export function createWorldStoreFromWorld(world: World, panelOptions?: WorldStorePanelOptions): WorldStore {
	return buildStore(
		world.id,
		new Map(world.workspaces.map((workspace) => [workspace.id, workspace])),
		panelOptions,
	);
}

/**
 * The one entry point for loading a World from outside this process's own
 * control (a persisted snapshot, an RPC payload): fails closed with a typed
 * outcome instead of throwing on malformed input. `panelOptions` is a
 * second, independent input -- a persisted World snapshot never carries
 * Panel state at all (`WorldStore.snapshot()`'s own return shape omits it),
 * so a caller re-seeding chrome Panels on every boot (fresh or rehydrated
 * alike) passes the same `panelOptions` it would to `createWorldStore`.
 */
export function hydrateWorldStore(input: unknown, panelOptions?: WorldStorePanelOptions): ParseResult<WorldStore> {
	const parsed = parseWithSchema(WorldSchema, input);
	if (!parsed.ok) return parsed;
	return { ok: true, value: createWorldStoreFromWorld(parsed.value, panelOptions) };
}
