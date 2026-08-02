import { useState } from "react";
import {
	activeWindow,
	addWindow,
	createWorkspace,
	dockChat,
	dockSurface,
	hideChat,
	isChatDocked,
	nextWindow,
	previousWindow,
	renameWindow,
	scrollWindow,
	selectWindow,
	showChat,
	toggleChat,
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
	activeWorkspaceId: string;
	selectWorkspace: (id: string) => void;
	workspace: Workspace;
	/** Every Workspace's real, current state keyed by id -- not just the active one. For cross-workspace correlation (e.g. the global-chat visibility cue); most consumers want `workspace` instead. */
	workspaces: Readonly<Record<string, Workspace>>;
	activeWindow: WorkspaceWindow;
	nextWindow: () => void;
	previousWindow: () => void;
	scrollWindow: (direction: 1 | -1) => void;
	selectWindow: (index: number) => void;
	addWindow: () => void;
	renameWindow: (windowId: string, title: string) => void;
	dockSurface: (templateId: string, title: string) => DockedSurfaceInstance;
	undockSurface: (surfaceInstanceId: string) => void;
	showChat: () => void;
	hideChat: () => void;
	toggleChat: () => void;
	isChatDocked: boolean;
	dockChat: (title: string) => DockedSurfaceInstance;
	undockChatToFloating: () => void;
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
	/** Optional -- emits workspace:selected/surface:docked/surface:undocked for any registered extension's on() handlers. */
	host?: ExtensionHost,
): WorkspaceRegistryHandle {
	const [workspaces, setWorkspaces] = useState<Record<string, Workspace>>(() => {
		const initial: Record<string, Workspace> = {};
		for (const entry of catalog) initial[entry.id] = createInitialWorkspace(entry.id, entry.title);
		return initial;
	});
	const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(() => catalog[0]?.id ?? "");

	const maybeWorkspace = workspaces[activeWorkspaceId];
	if (!maybeWorkspace) throw new Error(`useWorkspaceRegistry: no Workspace registered for id "${activeWorkspaceId}"`);
	// A fresh binding, not the destructured lookup above: TS can't carry a
	// `Workspace | undefined` narrowing through into the closures below, since
	// they could (as far as the type system can tell) run after activeWorkspaceId
	// changes -- a plain const assigned once here has no such ambiguity.
	const workspace: Workspace = maybeWorkspace;

	function update(transform: (current: Workspace) => Workspace): void {
		setWorkspaces((current) => {
			const target = current[activeWorkspaceId];
			return target ? { ...current, [activeWorkspaceId]: transform(target) } : current;
		});
	}

	function dock(templateId: string, title: string): DockedSurfaceInstance {
		const result = dockSurface(workspace, templateId, title);
		setWorkspaces((current) => ({ ...current, [activeWorkspaceId]: result.workspace }));
		host?.emit({ type: "surface:docked", workspaceId: activeWorkspaceId, windowId: activeWindow(result.workspace).id, instance: result.instance });
		return result.instance;
	}

	function dockChatSurface(title: string): DockedSurfaceInstance {
		const result = dockChat(workspace, title);
		setWorkspaces((current) => ({ ...current, [activeWorkspaceId]: result.workspace }));
		host?.emit({ type: "surface:docked", workspaceId: activeWorkspaceId, windowId: activeWindow(result.workspace).id, instance: result.instance });
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
		activeWindow: activeWindow(workspace),
		nextWindow: () => update(nextWindow),
		previousWindow: () => update(previousWindow),
		scrollWindow: (direction) => update((current) => scrollWindow(current, direction)),
		selectWindow: (index) => update((current) => selectWindow(current, index)),
		addWindow: () => update(addWindow),
		renameWindow: (windowId, title) => update((current) => renameWindow(current, windowId, title)),
		dockSurface: dock,
		undockSurface: (surfaceInstanceId) => {
			update((current) => undockSurface(current, surfaceInstanceId));
			host?.emit({ type: "surface:undocked", workspaceId: activeWorkspaceId, surfaceInstanceId });
		},
		showChat: () => update(showChat),
		hideChat: () => update(hideChat),
		toggleChat: () => update(toggleChat),
		isChatDocked: isChatDocked(workspace),
		dockChat: dockChatSurface,
		undockChatToFloating: () => update(undockChatToFloating),
	};
}
