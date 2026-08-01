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

/**
 * The mouse-wheel policy on the Window Carousel -- the same wrap-around
 * ring as nextWindow/previousWindow, not a separate policy. Never
 * creates or prunes a Window; explicit creation is still available via
 * addWindow/window.new, just not implicitly tied to scrolling an edge.
 */
export function scrollWindow(workspace: Workspace, direction: 1 | -1): Workspace {
	return direction > 0 ? nextWindow(workspace) : previousWindow(workspace);
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

/** The Conversation Chat Surface's reserved templateId when docked -- see dockChat/undockChatToFloating. */
export const CHAT_TEMPLATE_ID = "chat";

export function isChatDocked(workspace: Workspace): boolean {
	return workspace.windows.some((window) => window.dockedSurfaces.some((surface) => surface.templateId === CHAT_TEMPLATE_ID));
}

/**
 * Docks the Chat Surface into the active Window, turning off its floating
 * overlay. Chat is a singleton -- docking it again (from a different Window,
 * or the same one) moves it rather than creating a second instance.
 */
export function dockChat(workspace: Workspace, title: string): { workspace: Workspace; instance: DockedSurfaceInstance } {
	const withoutExistingChat = { ...workspace, windows: workspace.windows.map((window) => ({ ...window, dockedSurfaces: window.dockedSurfaces.filter((surface) => surface.templateId !== CHAT_TEMPLATE_ID) })) };
	const { workspace: docked, instance } = dockSurface(withoutExistingChat, CHAT_TEMPLATE_ID, title);
	return { workspace: { ...docked, chatVisible: false }, instance };
}

/** Removes Chat from wherever it's docked (a no-op if it isn't) and returns it to the floating overlay, visible. */
export function undockChatToFloating(workspace: Workspace): Workspace {
	const windows = workspace.windows.map((window) => ({ ...window, dockedSurfaces: window.dockedSurfaces.filter((surface) => surface.templateId !== CHAT_TEMPLATE_ID) }));
	return { ...workspace, windows, chatVisible: true };
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


