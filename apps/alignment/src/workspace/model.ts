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
	dockedSurfaces: DockedSurfaceInstance[];
}

export interface Workspace {
	id: string;
	title: string;
	conversationId: string;
	windows: WorkspaceWindow[];
	/** Index into `windows`, always in bounds -- see nextWindow/previousWindow for the wrap-around policy. */
	activeWindowIndex: number;
	/**
	 * The Conversation Chat Surface's visibility. It is a floating overlay,
	 * not a docked Surface -- hidden by default, summoned by an edge-hover or
	 * a keymap, never part of any Window's dockedSurfaces.
	 */
	chatVisible: boolean;
}

export interface WorkspaceDefinition {
	id: string;
	title: string;
	conversationId: string;
}

let instanceCounter = 0;

/** A fresh, collision-resistant id for a docked Surface instance or a new Window, without pulling in a uuid dependency for a single counter's worth of need. */
function nextInstanceId(prefix: string): string {
	instanceCounter += 1;
	return `${prefix}-${instanceCounter}`;
}

export function createWorkspace(definition: WorkspaceDefinition): Workspace {
	return {
		id: definition.id,
		title: definition.title,
		conversationId: definition.conversationId,
		windows: [{ id: nextInstanceId("window"), dockedSurfaces: [] }],
		activeWindowIndex: 0,
		chatVisible: false,
	};
}

export function activeWindow(workspace: Workspace): WorkspaceWindow {
	const window = workspace.windows[workspace.activeWindowIndex];
	if (!window) throw new Error(`Workspace ${workspace.id} has an out-of-bounds activeWindowIndex ${workspace.activeWindowIndex}`);
	return window;
}

/**
 * Moves to the next Window, wrapping from the last back to the first --
 * the Window Carousel is a ring, not a clamped strip.
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
	const windows = [...workspace.windows, { id: nextInstanceId("window"), dockedSurfaces: [] }];
	return { ...workspace, windows, activeWindowIndex: windows.length - 1 };
}

/** Docks a new Surface instance of `templateId` into the active Window. Returns the new Workspace and the instance's id, so a caller (e.g. the docking engine) can place it. */
export function dockSurface(workspace: Workspace, templateId: string, title: string): { workspace: Workspace; instance: DockedSurfaceInstance } {
	const instance: DockedSurfaceInstance = { id: nextInstanceId(templateId), templateId, title };
	const windows = workspace.windows.map((window, index) => (index === workspace.activeWindowIndex ? { ...window, dockedSurfaces: [...window.dockedSurfaces, instance] } : window));
	return { workspace: { ...workspace, windows }, instance };
}

/** Removes a docked Surface instance from whichever Window holds it (a no-op if the id isn't docked anywhere). */
export function undockSurface(workspace: Workspace, surfaceInstanceId: string): Workspace {
	const windows = workspace.windows.map((window) => ({ ...window, dockedSurfaces: window.dockedSurfaces.filter((surface) => surface.id !== surfaceInstanceId) }));
	return { ...workspace, windows };
}

export function showChat(workspace: Workspace): Workspace {
	return workspace.chatVisible ? workspace : { ...workspace, chatVisible: true };
}

export function hideChat(workspace: Workspace): Workspace {
	return workspace.chatVisible ? { ...workspace, chatVisible: false } : workspace;
}

export function toggleChat(workspace: Workspace): Workspace {
	return { ...workspace, chatVisible: !workspace.chatVisible };
}

/** Rebinds a Workspace to a different Conversation without disturbing its Windows or Chat visibility. */
export function withConversation(workspace: Workspace, conversationId: string): Workspace {
	if (workspace.conversationId === conversationId) return workspace;
	return { ...workspace, conversationId };
}

export function createFirstSliceWorkspace(conversationId: string): Workspace {
	return createWorkspace({ id: "alignment", title: "Alignment", conversationId });
}
