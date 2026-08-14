/**
 * What a docked Surface is actually bound to in the outside world -- the
 * client tool call a Surface Template's category maps to. `kind` matches a
 * Surface Templates gallery category; the rest of each variant is whatever
 * that category needs to describe one real binding target (a filesystem
 * root, a terminal's working directory, ...). Optional on
 * DockedSurfaceInstance since not every Surface is bound to anything --
 * Activity has no external system behind it.
 */
export type SurfaceBinding = { kind: "filesystem"; root: string } | { kind: "terminal"; cwd: string } | { kind: "tickets"; project: string } | { kind: "automation"; pipeline: string };

/**
 * One instance of a Surface Template docked into a Window's center. `id` is
 * unique per instance (a Window can dock the same template kind more than
 * once -- two Terminal surfaces, say), `templateId` names which entry in the
 * Surface Templates registry produced it.
 */
export interface DockedSurfaceInstance {
	id: string;
	templateId: string;
	title: string;
	binding?: SurfaceBinding;
}

/**
 * One Workspace's numbered arrangement slot. Each Window owns its own
 * independent set of docked Surfaces -- switching Windows changes what's in
 * the center, not the Workspace itself. The actual split/tab *geometry* of
 * those docked Surfaces is owned by the docking engine (dockview), not this
 * domain model; a Window only tracks *which* Surface instances exist.
 */
export interface WorkspaceWindow {
	id: string;
	/** User-renamable, defaults to "Window N" at creation -- see renameWindow. */
	title: string;
	dockedSurfaces: DockedSurfaceInstance[];
	/** True for a Window created by scrolling past the Carousel's end -- pruned automatically if the user scrolls away from it while still empty. Absent (not false) for every ordinarily-created Window. */
	ephemeral?: boolean;
}

export interface Workspace {
	id: string;
	title: string;
	windows: WorkspaceWindow[];
	/** Index into `windows`, always in bounds -- see nextWindow/previousWindow for the wrap-around policy. */
	activeWindowIndex: number;
}

export interface WorkspaceDefinition {
	id: string;
	title: string;
}

let instanceCounter = 0;

/** A fresh, collision-resistant id for a docked Surface instance or a new Window, without pulling in a uuid dependency for a single counter's worth of need. */
function nextInstanceId(prefix: string): string {
	instanceCounter += 1;
	return `${prefix}-${instanceCounter}`;
}

/**
 * `index` is the Window's own 0-based position -- the Carousel pill's own
 * number, so a fresh Window's default title always matches its glyph.
 * Chat is pre-docked from creation (see WindowDockview's mountAnchor for
 * how the docking engine places it) -- never a separate toggle.
 */
function createWindow(index: number): WorkspaceWindow {
	return { id: nextInstanceId("window"), title: `Window ${index}`, dockedSurfaces: [{ id: nextInstanceId(CHAT_TEMPLATE_ID), templateId: CHAT_TEMPLATE_ID, title: "Chat" }] };
}

export function createWorkspace(definition: WorkspaceDefinition): Workspace {
	return {
		id: definition.id,
		title: definition.title,
		windows: [createWindow(0)],
		activeWindowIndex: 0,
	};
}

/** Renames a Window by id; a blank (whitespace-only) title is rejected rather than leaving a Window with an empty name. */
export function renameWindow(workspace: Workspace, windowId: string, title: string): Workspace {
	const trimmed = title.trim();
	if (!trimmed) return workspace;
	return { ...workspace, windows: workspace.windows.map((window) => (window.id === windowId ? { ...window, title: trimmed } : window)) };
}

/** Renames a Workspace itself; a blank (whitespace-only) title is rejected rather than leaving a Workspace with an empty name -- same guard as renameWindow. */
export function renameWorkspace(workspace: Workspace, title: string): Workspace {
	const trimmed = title.trim();
	if (!trimmed) return workspace;
	return { ...workspace, title: trimmed };
}

export function activeWindow(workspace: Workspace): WorkspaceWindow {
	const window = workspace.windows[workspace.activeWindowIndex];
	if (!window) throw new Error(`Workspace ${workspace.id} has an out-of-bounds activeWindowIndex ${workspace.activeWindowIndex}`);
	return window;
}

/**
 * Moves to the next Window, wrapping from the last back to the first --
 * the Window Carousel is a ring, not a clamped strip. Each Window owns its
 * own Chat instance, so nothing needs relocating on switch.
 */
export function nextWindow(workspace: Workspace): Workspace {
	return { ...workspace, activeWindowIndex: (workspace.activeWindowIndex + 1) % workspace.windows.length };
}

/** Moves to the previous Window, wrapping from the first back to the last. */
export function previousWindow(workspace: Workspace): Workspace {
	const count = workspace.windows.length;
	return { ...workspace, activeWindowIndex: (workspace.activeWindowIndex - 1 + count) % count };
}

/** Jumps directly to a Window by index (e.g. clicking a specific entry in the Window Carousel). Throws for an out-of-bounds index -- a stale or mistyped index is a defect, not a case to silently clamp. */
export function selectWindow(workspace: Workspace, index: number): Workspace {
	if (index < 0 || index >= workspace.windows.length) throw new Error(`Workspace ${workspace.id} has no Window at index ${index}`);
	return { ...workspace, activeWindowIndex: index };
}

/** Appends a new empty Window at the end (index -1, rightmost) and switches to it. */
export function addWindow(workspace: Workspace): Workspace {
	const windows = [...workspace.windows, createWindow(workspace.windows.length)];
	return { ...workspace, windows, activeWindowIndex: windows.length - 1 };
}

/** "Empty" means no real Surface docked -- every Window (ephemeral ones included) always carries its own pre-docked Chat, which alone doesn't count as real content to preserve. */
function isEmptyEphemeral(window: WorkspaceWindow): boolean {
	return window.ephemeral === true && window.dockedSurfaces.every((surface) => surface.templateId === CHAT_TEMPLATE_ID);
}

/** Removes the Window at `index`, shifting activeWindowIndex down if it pointed past the removed one. Never removes the last remaining Window. */
function removeWindowAt(workspace: Workspace, index: number): Workspace {
	if (workspace.windows.length <= 1) return workspace;
	const windows = workspace.windows.filter((_, i) => i !== index);
	const activeWindowIndex = workspace.activeWindowIndex > index ? workspace.activeWindowIndex - 1 : workspace.activeWindowIndex;
	return { ...workspace, windows, activeWindowIndex };
}

/**
 * The Window Carousel's own scroll/wheel policy -- deliberately not the
 * same wrap-around ring as nextWindow/previousWindow (those still wrap, for
 * the window.next/window.previous commands). Scrolling past either end
 * creates exactly one new ephemeral Window instead of wrapping; scrolling
 * away from an empty ephemeral Window prunes it. Mid-list movement is a
 * plain +/-1 step.
 */
export function scrollWindow(workspace: Workspace, direction: 1 | -1): Workspace {
	const currentIndex = workspace.activeWindowIndex;
	const currentWindow = workspace.windows[currentIndex];
	if (!currentWindow) return workspace;
	const atEdge = direction > 0 ? currentIndex === workspace.windows.length - 1 : currentIndex === 0;

	if (atEdge) {
		if (isEmptyEphemeral(currentWindow)) return workspace; // already at the transient slot -- nothing further to create
		// Its real final index is 0 when prepended (every existing Window shifts up, but keeps its own already-assigned title -- a title is fixed at creation, not live-recomputed from position), or the current length when appended.
		const newWindow: WorkspaceWindow = { ...createWindow(direction > 0 ? workspace.windows.length : 0), ephemeral: true };
		const windows = direction > 0 ? [...workspace.windows, newWindow] : [newWindow, ...workspace.windows];
		return { ...workspace, windows, activeWindowIndex: direction > 0 ? windows.length - 1 : 0 };
	}

	const moved = { ...workspace, activeWindowIndex: currentIndex + direction };
	return isEmptyEphemeral(currentWindow) ? removeWindowAt(moved, currentIndex) : moved;
}

/** Docks a new Surface instance of `templateId` into the active Window. `binding` is optional -- omit it for a Surface with no real external system behind it (e.g. Activity). Returns the new Workspace and the instance's id, so a caller (e.g. the docking engine) can place it. */
export function dockSurface(workspace: Workspace, templateId: string, title: string, binding?: SurfaceBinding): { workspace: Workspace; instance: DockedSurfaceInstance } {
	const instance: DockedSurfaceInstance = { id: nextInstanceId(templateId), templateId, title, ...(binding ? { binding } : {}) };
	// Docking into an ephemeral Window promotes it to a real, permanent one -- it's no longer eligible for scroll-away pruning.
	const windows = workspace.windows.map((window, index) => (index === workspace.activeWindowIndex ? { ...window, dockedSurfaces: [...window.dockedSurfaces, instance], ephemeral: false } : window));
	return { workspace: { ...workspace, windows }, instance };
}

/**
 * Coarse tool-name-to-binding-kind mapping, grounded in real Pi/Alef tool
 * names -- not exhaustive, but enough to correlate a tool call to a bound
 * Surface's category without parsing each tool's own argument shape.
 */
const TOOL_NAME_TO_BINDING_KIND: Record<string, SurfaceBinding["kind"]> = {
	read: "filesystem",
	write: "filesystem",
	edit: "filesystem",
	find: "filesystem",
	ls: "filesystem",
	bash: "terminal",
	shell: "terminal",
};

export function surfaceBindingKindForToolName(toolName: string): SurfaceBinding["kind"] | undefined {
	return TOOL_NAME_TO_BINDING_KIND[toolName];
}

/** Finds the first docked Surface instance (in any Window) whose binding kind matches the tool call, or undefined if none is docked here. */
export function findDockedSurfaceForToolName(workspace: Workspace, toolName: string): { window: WorkspaceWindow; instance: DockedSurfaceInstance } | undefined {
	const kind = surfaceBindingKindForToolName(toolName);
	if (!kind) return undefined;
	for (const window of workspace.windows) {
		const instance = window.dockedSurfaces.find((surface) => surface.binding?.kind === kind);
		if (instance) return { window, instance };
	}
	return undefined;
}

/** The same correlation as findDockedSurfaceForToolName, across every Workspace in a registry -- which Workspace (by id) is the tool call actually about. */
export function findWorkspaceIdForToolName(workspaces: Readonly<Record<string, Workspace>>, toolName: string): string | undefined {
	for (const [id, workspace] of Object.entries(workspaces)) {
		if (findDockedSurfaceForToolName(workspace, toolName)) return id;
	}
	return undefined;
}

/** Removes a docked Surface instance from whichever Window holds it (a no-op if the id isn't docked anywhere). */
export function undockSurface(workspace: Workspace, surfaceInstanceId: string): Workspace {
	const windows = workspace.windows.map((window) => ({ ...window, dockedSurfaces: window.dockedSurfaces.filter((surface) => surface.id !== surfaceInstanceId) }));
	return { ...workspace, windows };
}

/** Identifies the docked Chat Surface among a Window's dockedSurfaces (see createWindow, dockChat). */
export const CHAT_TEMPLATE_ID = "chat";

export function isChatDocked(workspace: Workspace): boolean {
	return workspace.windows.some((window) => window.dockedSurfaces.some((surface) => surface.templateId === CHAT_TEMPLATE_ID));
}

/** Re-docks Chat into the active Window if the user closed it (every Window starts with it docked -- see createWindow). A no-op returning the existing instance if it's already there. */
export function dockChat(workspace: Workspace, title: string): { workspace: Workspace; instance: DockedSurfaceInstance } {
	const existing = activeWindow(workspace).dockedSurfaces.find((surface) => surface.templateId === CHAT_TEMPLATE_ID);
	if (existing) return { workspace, instance: existing };
	return dockSurface(workspace, CHAT_TEMPLATE_ID, title);
}



