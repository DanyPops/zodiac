import type { IntegrationDefinition, IntegrationId, Workspace } from "@zodiac/protocol";

/** One Integration's contributed tool id, looked up independently of IntegrationDefinition itself. */
export interface ToolContribution {
	readonly integrationId: IntegrationId;
	readonly toolId: string;
}

/** Tool ids granted by a Workspace's currently-docked Surfaces. Gates on capabilities.hasApi, same as authorizeAgentCommand. */
export function deriveWorkspaceToolIds(
	workspace: Workspace,
	getIntegration: (id: IntegrationId) => IntegrationDefinition | undefined,
	getContribution: (id: IntegrationId) => ToolContribution | undefined,
): ReadonlySet<string> {
	const toolIds = new Set<string>();
	for (const surface of workspace.surfaces) {
		const integration = getIntegration(surface.integrationId);
		if (!integration || !integration.capabilities.hasApi) continue;
		const contribution = getContribution(surface.integrationId);
		if (contribution) toolIds.add(contribution.toolId);
	}
	return toolIds;
}

export interface ToolGrantDiff {
	readonly added: readonly string[];
	readonly removed: readonly string[];
}

export function diffToolIds(previous: ReadonlySet<string>, next: ReadonlySet<string>): ToolGrantDiff {
	const added = [...next].filter((toolId) => !previous.has(toolId));
	const removed = [...previous].filter((toolId) => !next.has(toolId));
	return { added, removed };
}
