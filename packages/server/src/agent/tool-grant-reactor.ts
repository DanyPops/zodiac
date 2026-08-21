import type { IntegrationDefinition, IntegrationId, WorkspaceId } from "@zodiac/protocol";
import type { WorldStore } from "../world/store.js";
import { deriveWorkspaceToolIds, diffToolIds, type ToolContribution } from "./tool-grant.js";

export interface ToolRegistrar {
	addTool(workspaceId: WorkspaceId, toolId: string): void;
	removeTool(workspaceId: WorkspaceId, toolId: string): void;
}

/** Keeps a ToolRegistrar in sync with each Workspace's derived tool grant on every WorldStore change. Returns an unsubscribe function. */
export function watchWorkspaceToolGrants(
	worldStore: WorldStore,
	getIntegration: (id: IntegrationId) => IntegrationDefinition | undefined,
	getContribution: (id: IntegrationId) => ToolContribution | undefined,
	registrar: ToolRegistrar,
): () => void {
	const grantedByWorkspace = new Map<WorkspaceId, ReadonlySet<string>>();

	function reconcile(workspaceId: WorkspaceId): void {
		const workspace = worldStore.getWorkspace(workspaceId);
		if (!workspace) return;
		const next = deriveWorkspaceToolIds(workspace, getIntegration, getContribution);
		const previous = grantedByWorkspace.get(workspaceId) ?? new Set<string>();
		const { added, removed } = diffToolIds(previous, next);
		for (const toolId of added) registrar.addTool(workspaceId, toolId);
		for (const toolId of removed) registrar.removeTool(workspaceId, toolId);
		grantedByWorkspace.set(workspaceId, next);
	}

	return worldStore.onChange(({ viewModel }) => {
		for (const workspace of viewModel.workspaces) reconcile(workspace.id);
	});
}
