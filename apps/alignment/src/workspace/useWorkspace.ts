import { useEffect, useState } from "react";
import {
	activeWindow,
	addWindow,
	createFirstSliceWorkspace,
	dockChat,
	dockSurface,
	hideChat,
	isChatDocked,
	nextWindow,
	previousWindow,
	scrollWindow,
	selectWindow,
	showChat,
	toggleChat,
	undockChatToFloating,
	undockSurface,
	withConversation,
	type DockedSurfaceInstance,
	type Workspace,
	type WorkspaceWindow,
} from "./model.js";

export interface WorkspaceHandle {
	workspace: Workspace;
	activeWindow: WorkspaceWindow;
	nextWindow: () => void;
	previousWindow: () => void;
	scrollWindow: (direction: 1 | -1) => void;
	selectWindow: (index: number) => void;
	addWindow: () => void;
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
 * Owns one Workspace's lifecycle: creates it, rebinds it to a new
 * Conversation as selection changes, and applies Window/docking/Chat
 * visibility transitions -- the driving port the UI composes against
 * instead of reaching into workspace/model.ts's pure functions directly.
 */
export function useWorkspace(conversationId: string): WorkspaceHandle {
	const [workspace, setWorkspace] = useState<Workspace>(() => createFirstSliceWorkspace(conversationId));

	useEffect(() => {
		setWorkspace((current) => withConversation(current, conversationId));
	}, [conversationId]);

	// Reads `workspace` directly from this render's closure (fresh every render,
	// not memoized) rather than through a setState updater function -- computing
	// the result here, once, is simpler than smuggling it out of an updater
	// whose synchronous-invocation timing is a React implementation detail, not
	// a documented guarantee.
	function dock(templateId: string, title: string): DockedSurfaceInstance {
		const result = dockSurface(workspace, templateId, title);
		setWorkspace(result.workspace);
		return result.instance;
	}

	function dockChatSurface(title: string): DockedSurfaceInstance {
		const result = dockChat(workspace, title);
		setWorkspace(result.workspace);
		return result.instance;
	}

	return {
		workspace,
		activeWindow: activeWindow(workspace),
		nextWindow: () => setWorkspace(nextWindow),
		previousWindow: () => setWorkspace(previousWindow),
		scrollWindow: (direction) => setWorkspace((current) => scrollWindow(current, direction)),
		selectWindow: (index) => setWorkspace((current) => selectWindow(current, index)),
		addWindow: () => setWorkspace(addWindow),
		dockSurface: dock,
		undockSurface: (surfaceInstanceId) => setWorkspace((current) => undockSurface(current, surfaceInstanceId)),
		showChat: () => setWorkspace(showChat),
		hideChat: () => setWorkspace(hideChat),
		toggleChat: () => setWorkspace(toggleChat),
		isChatDocked: isChatDocked(workspace),
		dockChat: dockChatSurface,
		undockChatToFloating: () => setWorkspace(undockChatToFloating),
	};
}
