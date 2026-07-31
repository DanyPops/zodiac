import { useEffect, useState } from "react";
import { activateSurface, createFirstSliceWorkspace, visibleSurfaceId, withConversation, type Workspace } from "./model.js";

export interface WorkspaceHandle {
	workspace: Workspace;
	visibleSurfaceId: (parentId: string) => string | undefined;
	activateSurface: (surfaceId: string) => void;
}

/** Owns one Workspace's lifecycle: creates it, rebinds it to a new Conversation as selection changes, and applies focus/visibility transitions -- the driving port the UI composes against instead of reaching into workspace/model.ts's pure functions directly. */
export function useWorkspace(conversationId: string): WorkspaceHandle {
	const [workspace, setWorkspace] = useState<Workspace>(() => createFirstSliceWorkspace(conversationId));

	useEffect(() => {
		setWorkspace((current) => withConversation(current, conversationId));
	}, [conversationId]);

	return {
		workspace,
		visibleSurfaceId: (parentId) => visibleSurfaceId(workspace, parentId),
		activateSurface: (surfaceId) => setWorkspace((current) => activateSurface(current, surfaceId)),
	};
}
