export type WorkspaceSurfaceKind = "chat" | "conversation" | "activity";
export type SurfaceLayout = "leaf" | "tabs" | "split-horizontal" | "split-vertical";

export interface WorkspaceSurfaceSpec {
	id: string;
	kind: WorkspaceSurfaceKind;
	title: string;
	layout: SurfaceLayout;
	parentId?: string;
}

export interface WorkspaceSurface extends WorkspaceSurfaceSpec {
	childIds: string[];
}

export interface WorkspaceDefinition {
	id: string;
	title: string;
	conversationId: string;
	surfaces: WorkspaceSurfaceSpec[];
}

export interface Workspace {
	id: string;
	title: string;
	conversationId: string;
	rootSurfaceIds: string[];
	surfaces: Record<string, WorkspaceSurface>;
	/** Which child is currently visible for each non-leaf surface, keyed by parent id. Absent until activateSurface sets one explicitly. */
	activeChildBySurfaceId: Record<string, string>;
}

const MAX_SURFACE_DEPTH = 4;

export function createWorkspace(definition: WorkspaceDefinition): Workspace {
	const surfaces: Record<string, WorkspaceSurface> = {};
	for (const spec of definition.surfaces) {
		if (surfaces[spec.id]) throw new Error(`Duplicate WorkspaceSurface id: ${spec.id}`);
		surfaces[spec.id] = { ...spec, childIds: [] };
	}

	for (const surface of Object.values(surfaces)) {
		if (!surface.parentId) continue;
		const parent = surfaces[surface.parentId];
		if (!parent) throw new Error(`WorkspaceSurface ${surface.id} has missing parent ${surface.parentId}`);
		if (parent.layout === "leaf") throw new Error(`Leaf WorkspaceSurface ${parent.id} cannot contain children`);
		parent.childIds.push(surface.id);
	}

	for (const surface of Object.values(surfaces)) assertAcyclicAndBounded(surface, surfaces);

	return {
		id: definition.id,
		title: definition.title,
		conversationId: definition.conversationId,
		rootSurfaceIds: definition.surfaces.filter((surface) => !surface.parentId).map((surface) => surface.id),
		surfaces,
		activeChildBySurfaceId: {},
	};
}

/**
 * The child surface a non-leaf surface should currently show: whichever one
 * was last explicitly activated, falling back to its first child by
 * containment order. Undefined for a leaf surface (nothing to show) or an
 * unknown/childless parent id.
 */
export function visibleSurfaceId(workspace: Workspace, parentId: string): string | undefined {
	const parent = workspace.surfaces[parentId];
	if (!parent || parent.childIds.length === 0) return undefined;
	return workspace.activeChildBySurfaceId[parentId] ?? parent.childIds[0];
}

/**
 * Activates a surface as the visible child of its parent. Returns a new
 * Workspace rather than mutating the given one, so callers (and tests) can
 * compare before/after state. Throws for an id that isn't part of this
 * Workspace's containment tree at all -- a stale or mistyped id is a defect,
 * not a case to silently ignore.
 */
export function activateSurface(workspace: Workspace, surfaceId: string): Workspace {
	const surface = workspace.surfaces[surfaceId];
	if (!surface) throw new Error(`Cannot activate unknown surface id: ${surfaceId}`);
	if (!surface.parentId) return workspace;
	return {
		...workspace,
		activeChildBySurfaceId: { ...workspace.activeChildBySurfaceId, [surface.parentId]: surfaceId },
	};
}

/** Rebinds a Workspace to a different Conversation without disturbing its surface tree or current focus/visibility state. */
export function withConversation(workspace: Workspace, conversationId: string): Workspace {
	if (workspace.conversationId === conversationId) return workspace;
	return { ...workspace, conversationId };
}

function assertAcyclicAndBounded(start: WorkspaceSurface, surfaces: Record<string, WorkspaceSurface>): void {
	const visited = new Set<string>();
	let current: WorkspaceSurface | undefined = start;
	let depth = 0;
	while (current?.parentId) {
		if (visited.has(current.id)) throw new Error(`WorkspaceSurface containment cycle at ${current.id}`);
		visited.add(current.id);
		depth += 1;
		if (depth > MAX_SURFACE_DEPTH) throw new Error(`WorkspaceSurface ${start.id} exceeds maximum depth ${MAX_SURFACE_DEPTH}`);
		current = surfaces[current.parentId];
	}
}

/** Well-known surface ids for the first-slice Workspace -- the single source of truth other modules (App.tsx, chat-surface-registry.tsx) reference instead of retyping string literals. */
export const CHAT_SURFACE_ID = "chat";
export const CONVERSATION_SURFACE_ID = "conversation";
export const ACTIVITY_SURFACE_ID = "activity";

export function createFirstSliceWorkspace(conversationId: string): Workspace {
	return createWorkspace({
		id: "alignment",
		title: "Alignment",
		conversationId,
		surfaces: [
			{ id: CHAT_SURFACE_ID, kind: "chat", title: "Chat", layout: "tabs" },
			{ id: CONVERSATION_SURFACE_ID, kind: "conversation", title: "Conversation", layout: "leaf", parentId: CHAT_SURFACE_ID },
			{ id: ACTIVITY_SURFACE_ID, kind: "activity", title: "Activity", layout: "leaf", parentId: CHAT_SURFACE_ID },
		],
	});
}
