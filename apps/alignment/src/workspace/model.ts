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
	/**
	 * The Conversation Chat Surface's visibility. It is a floating overlay,
	 * not a docked Surface -- hidden by default, summoned by an edge-hover or
	 * a keymap, never part of any Window's dockedSurfaces.
	 */
	chatVisible: boolean;
	/**
	 * Only meaningful while Chat is docked. Unpinned (the default the moment
	 * it docks) means Chat travels with whichever Window becomes active --
	 * see the window-navigation functions below. Pinned locks it to whatever
	 * specific Window it's currently in.
	 */
	chatPinned: boolean;
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

function createWindow(ordinal: number): WorkspaceWindow {
	return { id: nextInstanceId("window"), title: `Window ${ordinal}`, dockedSurfaces: [] };
}

export function createWorkspace(definition: WorkspaceDefinition): Workspace {
	return {
		id: definition.id,
		title: definition.title,
		windows: [createWindow(1)],
		activeWindowIndex: 0,
		chatVisible: false,
		chatPinned: false,
	};
}

/** Renames a Window by id; a blank (whitespace-only) title is rejected rather than leaving a Window with an empty name. */
export function renameWindow(workspace: Workspace, windowId: string, title: string): Workspace {
	const trimmed = title.trim();
	if (!trimmed) return workspace;
	return { ...workspace, windows: workspace.windows.map((window) => (window.id === windowId ? { ...window, title: trimmed } : window)) };
}

export function activeWindow(workspace: Workspace): WorkspaceWindow {
	const window = workspace.windows[workspace.activeWindowIndex];
	if (!window) throw new Error(`Workspace ${workspace.id} has an out-of-bounds activeWindowIndex ${workspace.activeWindowIndex}`);
	return window;
}

/** If Chat is docked, unpinned, and the active Window just changed, relocates it into the new active Window -- Chat "travels" with Carousel navigation unless pinned. A no-op otherwise (including when Chat isn't docked at all). */
function withChatFollowing(before: Workspace, after: Workspace): Workspace {
	if (after.activeWindowIndex === before.activeWindowIndex) return after;
	if (after.chatPinned || !isChatDocked(after)) return after;
	return relocateChatToActiveWindow(after);
}

function relocateChatToActiveWindow(workspace: Workspace): Workspace {
	let title = "Chat";
	for (const window of workspace.windows) {
		const chat = window.dockedSurfaces.find((surface) => surface.templateId === CHAT_TEMPLATE_ID);
		if (chat) {
			title = chat.title;
			break;
		}
	}
	const withoutChat = { ...workspace, windows: workspace.windows.map((window) => ({ ...window, dockedSurfaces: window.dockedSurfaces.filter((surface) => surface.templateId !== CHAT_TEMPLATE_ID) })) };
	return dockSurface(withoutChat, CHAT_TEMPLATE_ID, title).workspace;
}

/**
 * Moves to the next Window, wrapping from the last back to the first --
 * the Window Carousel is a ring, not a clamped strip.
 */
export function nextWindow(workspace: Workspace): Workspace {
	return withChatFollowing(workspace, { ...workspace, activeWindowIndex: (workspace.activeWindowIndex + 1) % workspace.windows.length });
}

/** Moves to the previous Window, wrapping from the first back to the last. */
export function previousWindow(workspace: Workspace): Workspace {
	const count = workspace.windows.length;
	return withChatFollowing(workspace, { ...workspace, activeWindowIndex: (workspace.activeWindowIndex - 1 + count) % count });
}

/** Jumps directly to a Window by index (e.g. clicking a specific entry in the Window Carousel). Throws for an out-of-bounds index -- a stale or mistyped index is a defect, not a case to silently clamp. */
export function selectWindow(workspace: Workspace, index: number): Workspace {
	if (index < 0 || index >= workspace.windows.length) throw new Error(`Workspace ${workspace.id} has no Window at index ${index}`);
	return withChatFollowing(workspace, { ...workspace, activeWindowIndex: index });
}

/** Appends a new empty Window at the end (index -1, rightmost) and switches to it. */
export function addWindow(workspace: Workspace): Workspace {
	const windows = [...workspace.windows, createWindow(workspace.windows.length + 1)];
	return { ...workspace, windows, activeWindowIndex: windows.length - 1 };
}

function isEmptyEphemeral(window: WorkspaceWindow): boolean {
	return window.ephemeral === true && window.dockedSurfaces.length === 0;
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
		const newWindow: WorkspaceWindow = { ...createWindow(workspace.windows.length + 1), ephemeral: true };
		const windows = direction > 0 ? [...workspace.windows, newWindow] : [newWindow, ...workspace.windows];
		return withChatFollowing(workspace, { ...workspace, windows, activeWindowIndex: direction > 0 ? windows.length - 1 : 0 });
	}

	const moved = { ...workspace, activeWindowIndex: currentIndex + direction };
	const pruned = isEmptyEphemeral(currentWindow) ? removeWindowAt(moved, currentIndex) : moved;
	return withChatFollowing(workspace, pruned);
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

/** The Conversation Chat Surface's reserved templateId when docked -- see dockChat/undockChatToFloating. */
export const CHAT_TEMPLATE_ID = "chat";

export function isChatDocked(workspace: Workspace): boolean {
	return workspace.windows.some((window) => window.dockedSurfaces.some((surface) => surface.templateId === CHAT_TEMPLATE_ID));
}

/**
 * Docks the Chat Surface into the active Window, turning off its floating
 * overlay. Chat is a singleton -- docking it again (from a different Window,
 * or the same one) moves it rather than creating a second instance. Always
 * starts unpinned ("following") -- pinning is a separate, explicit step.
 */
export function dockChat(workspace: Workspace, title: string): { workspace: Workspace; instance: DockedSurfaceInstance } {
	const withoutExistingChat = { ...workspace, windows: workspace.windows.map((window) => ({ ...window, dockedSurfaces: window.dockedSurfaces.filter((surface) => surface.templateId !== CHAT_TEMPLATE_ID) })) };
	const { workspace: docked, instance } = dockSurface(withoutExistingChat, CHAT_TEMPLATE_ID, title);
	return { workspace: { ...docked, chatVisible: false, chatPinned: false }, instance };
}

/** Removes Chat from wherever it's docked (a no-op if it isn't) and returns it to the floating overlay, visible. Pin state resets -- it's only meaningful while docked. */
export function undockChatToFloating(workspace: Workspace): Workspace {
	const windows = workspace.windows.map((window) => ({ ...window, dockedSurfaces: window.dockedSurfaces.filter((surface) => surface.templateId !== CHAT_TEMPLATE_ID) }));
	return { ...workspace, windows, chatVisible: true, chatPinned: false };
}

/** Locks docked Chat to whichever Window it's currently in, stopping it from traveling with the active Window. A no-op (same reference back) if already pinned. */
export function pinChat(workspace: Workspace): Workspace {
	return workspace.chatPinned ? workspace : { ...workspace, chatPinned: true };
}

/** Unpins docked Chat, letting it resume traveling with the active Window. A no-op (same reference back) if already unpinned. */
export function unpinChat(workspace: Workspace): Workspace {
	return workspace.chatPinned ? { ...workspace, chatPinned: false } : workspace;
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


