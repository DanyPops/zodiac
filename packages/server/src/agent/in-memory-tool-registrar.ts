import type { WorkspaceId } from "@zodiac/protocol";
import type { ToolRegistrar } from "./tool-grant-reactor.js";

export interface QueryableToolRegistrar extends ToolRegistrar {
	toolIds(workspaceId: WorkspaceId): readonly string[];
}

export function createInMemoryToolRegistrar(): QueryableToolRegistrar {
	const byWorkspace = new Map<WorkspaceId, Set<string>>();
	return {
		addTool(workspaceId, toolId) {
			const set = byWorkspace.get(workspaceId) ?? new Set<string>();
			set.add(toolId);
			byWorkspace.set(workspaceId, set);
		},
		removeTool(workspaceId, toolId) {
			byWorkspace.get(workspaceId)?.delete(toolId);
		},
		toolIds(workspaceId) {
			return [...(byWorkspace.get(workspaceId) ?? [])];
		},
	};
}
