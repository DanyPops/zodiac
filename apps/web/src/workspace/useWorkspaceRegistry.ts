import { useEffect, useState } from "react";
import {
	activeWindow,
	addWindow,
	createWorkspace,
	dockChat,
	dockSurface,
	hideChat,
	isChatDocked,
	nextWindow,
	pinChat,
	previousWindow,
	renameWindow,
	renameWorkspace as renameWorkspaceModel,
	scrollWindow,
	selectWindow,
	showChat,
	toggleChat,
	unpinChat,
	undockChatToFloating,
	undockSurface,
	type DockedSurfaceInstance,
	type Workspace,
	type WorkspaceWindow,
} from "./model.js";
import type { ExtensionHost } from "../extensions/extension-host.js";
import type { WorkspaceCatalogEntry } from "./workspace-catalog.js";

export interface WorkspaceRegistryHandle {
	/** Every known Workspace, in catalog order -- for rendering the left pillar. */
	catalog: readonly WorkspaceCatalogEntry[];
	/** Undefined when the catalog is empty -- Zodiac now genuinely starts with zero Workspaces (see the empty-by-default + auto-create-on-first-prompt behavior); every other action below already tolerates this by no-op'ing rather than throwing. */
	activeWorkspaceId: string | undefined;
	selectWorkspace: (id: string) => void;
	/** Renames any Workspace by id, not just the active one -- so a sidebar entry can be renamed without first switching to it. A blank (whitespace-only) title is rejected, and an unknown id is a no-op -- same guards as model.ts's renameWorkspace. */
	renameWorkspace: (id: string, title: string) => void;
	/** Drops a Workspace's in-memory state (Windows, docked Surfaces, Chat visibility -- everything) by id; an unknown id is a no-op. If it was the active Workspace, activates the next remaining `catalog` entry, or becomes undefined if none remain -- the same genuinely-empty state a fresh app starts in. Only the in-memory half -- see useUserWorkspaces' own removeWorkspace for the persisted catalog entry; a caller (App.tsx) calls both together. */
	removeWorkspace: (id: string) => void;
	/** Undefined exactly when activeWorkspaceId is -- a genuinely empty catalog, not a caller defect. A stale/mistyped id against a *non-empty* catalog still throws (see the hook body). */
	workspace: Workspace | undefined;
	/** Every Workspace's real, current state keyed by id -- not just the active one. For cross-workspace correlation (e.g. the global-chat visibility cue); most consumers want `workspace` instead. */
	workspaces: Readonly<Record<string, Workspace>>;
	activeWindow: WorkspaceWindow | undefined;
	nextWindow: () => void;
	previousWindow: () => void;
	scrollWindow: (direction: 1 | -1) => void;
	selectWindow: (index: number) => void;
	addWindow: () => void;
	renameWindow: (windowId: string, title: string) => void;
	dockSurface: (templateId: string, title: string) => DockedSurfaceInstance | undefined;
	undockSurface: (surfaceInstanceId: string) => void;
	showChat: () => void;
	hideChat: () => void;
	toggleChat: () => void;
	isChatDocked: boolean;
	dockChat: (title: string) => DockedSurfaceInstance | undefined;
	undockChatToFloating: () => void;
	chatPinned: boolean;
	pinChat: () => void;
	unpinChat: () => void;
}

/**
 * Owns *every* Workspace's lifecycle, keyed by catalog id -- not one
 * Workspace rebound to whatever Conversation happens to be selected. A
 * Workspace is its own independent Canvas (Windows, docked Surfaces, Chat
 * visibility); a Conversation is a Surface that may float globally, float
 * inside a Workspace, or dock into one, never the same thing as a
 * Workspace. Switching the active Workspace here only changes *which*
 * Workspace's own state the rest of the UI reads/writes -- every other
 * Workspace keeps its own Windows/docking/Chat state exactly as it was.
 */
export function useWorkspaceRegistry(
	catalog: readonly WorkspaceCatalogEntry[],
	/** Builds each catalog entry's starting Workspace -- defaults to a plain, single-Window `createWorkspace`. A caller (e.g. App.tsx, for the mock catalog's demo Windows) may pass a different factory without this hook itself knowing or caring that the result is demo data. */
	createInitialWorkspace: (id: string, title: string) => Workspace = (id, title) => createWorkspace({ id, title }),
	/** Optional -- emits workspace:selected/workspace:removed/surface:docked/surface:undocked for any registered extension's on() handlers. */
	host?: ExtensionHost,
): WorkspaceRegistryHandle {
	const [workspaces, setWorkspaces] = useState<Record<string, Workspace>>(() => {
		const initial: Record<string, Workspace> = {};
		for (const entry of catalog) initial[entry.id] = createInitialWorkspace(entry.id, entry.title);
		return initial;
	});
	const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | undefined>(() => catalog[0]?.id);

	// `catalog` can grow after mount (e.g. a user creates a new Workspace via
	// useUserWorkspaces) -- the state initializer above only runs once, so a
	// newly-appeared entry needs its own Workspace lazily added here, not
	// silently missing until the whole hook remounts.
	useEffect(() => {
		setWorkspaces((current) => {
			const missing = catalog.filter((entry) => !current[entry.id]);
			if (missing.length === 0) return current;
			const next = { ...current };
			for (const entry of missing) next[entry.id] = createInitialWorkspace(entry.id, entry.title);
			return next;
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- createInitialWorkspace is expected to be a stable, top-level function reference (App.tsx passes createDemoWorkspace); re-running for every new closure identity would defeat the point.
	}, [catalog]);

	const maybeWorkspace = activeWorkspaceId === undefined ? undefined : workspaces[activeWorkspaceId];
	const catalogEntry = activeWorkspaceId === undefined ? undefined : catalog.find((entry) => entry.id === activeWorkspaceId);
	// A genuinely empty catalog (activeWorkspaceId undefined) is the expected
	// "no Workspace yet" state, not a defect -- every action below already
	// tolerates `workspace` being undefined. An id absent from *both* the
	// materialized `workspaces` state and the current `catalog` prop while
	// activeWorkspaceId IS set is still a genuine caller defect (a stale or
	// mistyped id) and still throws. An id that's in `catalog` but not yet
	// materialized (selectWorkspace called in the same tick as just creating
	// it, before the reactive effect above has run) is expected and
	// transient, not a bug: fall back to a fresh Workspace for this render
	// rather than crashing on a timing window that self-heals on the next
	// effect flush.
	if (activeWorkspaceId !== undefined && !maybeWorkspace && !catalogEntry) throw new Error(`useWorkspaceRegistry: no Workspace registered for id "${activeWorkspaceId}"`);
	// A fresh binding, not the destructured lookup above: TS can't carry a
	// `Workspace | undefined` narrowing through into the closures below, since
	// they could (as far as the type system can tell) run after activeWorkspaceId
	// changes -- a plain const assigned once here has no such ambiguity.
	const workspace: Workspace | undefined = maybeWorkspace ?? (activeWorkspaceId !== undefined && catalogEntry ? createInitialWorkspace(activeWorkspaceId, catalogEntry.title) : undefined);

	function update(transform: (current: Workspace) => Workspace): void {
		if (activeWorkspaceId === undefined) return;
		const id = activeWorkspaceId;
		setWorkspaces((current) => {
			const target = current[id];
			return target ? { ...current, [id]: transform(target) } : current;
		});
	}

	function dock(templateId: string, title: string): DockedSurfaceInstance | undefined {
		if (activeWorkspaceId === undefined || !workspace) return undefined;
		const id = activeWorkspaceId;
		const result = dockSurface(workspace, templateId, title);
		setWorkspaces((current) => ({ ...current, [id]: result.workspace }));
		host?.emit({ type: "surface:docked", workspaceId: id, windowId: activeWindow(result.workspace).id, instance: result.instance });
		return result.instance;
	}

	function dockChatSurface(title: string): DockedSurfaceInstance | undefined {
		if (activeWorkspaceId === undefined || !workspace) return undefined;
		const id = activeWorkspaceId;
		const result = dockChat(workspace, title);
		setWorkspaces((current) => ({ ...current, [id]: result.workspace }));
		host?.emit({ type: "surface:docked", workspaceId: id, windowId: activeWindow(result.workspace).id, instance: result.instance });
		return result.instance;
	}

	return {
		catalog,
		activeWorkspaceId,
		selectWorkspace: (id) => {
			setActiveWorkspaceId(id);
			host?.emit({ type: "workspace:selected", workspaceId: id });
		},
		workspace,
		workspaces,
		activeWindow: workspace ? activeWindow(workspace) : undefined,
		nextWindow: () => update(nextWindow),
		previousWindow: () => update(previousWindow),
		scrollWindow: (direction) => update((current) => scrollWindow(current, direction)),
		selectWindow: (index) => update((current) => selectWindow(current, index)),
		addWindow: () => update(addWindow),
		renameWindow: (windowId, title) => update((current) => renameWindow(current, windowId, title)),
		renameWorkspace: (id, title) => {
			setWorkspaces((current) => {
				const target = current[id];
				if (!target) return current;
				return { ...current, [id]: renameWorkspaceModel(target, title) };
			});
		},
		removeWorkspace: (id) => {
			setWorkspaces((current) => {
				if (!(id in current)) return current;
				return Object.fromEntries(Object.entries(current).filter(([entryId]) => entryId !== id));
			});
			setActiveWorkspaceId((current) => {
				if (current !== id) return current;
				return catalog.find((entry) => entry.id !== id)?.id;
			});
			host?.emit({ type: "workspace:removed", workspaceId: id });
		},
		dockSurface: dock,
		undockSurface: (surfaceInstanceId) => {
			if (activeWorkspaceId === undefined) return;
			const id = activeWorkspaceId;
			update((current) => undockSurface(current, surfaceInstanceId));
			host?.emit({ type: "surface:undocked", workspaceId: id, surfaceInstanceId });
		},
		showChat: () => update(showChat),
		hideChat: () => update(hideChat),
		toggleChat: () => update(toggleChat),
		isChatDocked: workspace ? isChatDocked(workspace) : false,
		dockChat: dockChatSurface,
		undockChatToFloating: () => update(undockChatToFloating),
		chatPinned: workspace?.chatPinned ?? false,
		pinChat: () => update(pinChat),
		unpinChat: () => update(unpinChat),
	};
}
