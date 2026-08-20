import { deriveAgentSpace } from "@zodiac/server/agent";
import type { IntegrationDefinition } from "@zodiac/protocol";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchActiveIntegrationIds } from "./world-snapshot.js";

const ListAgentSpaceArgsSchema = Type.Object({
	workspaceId: Type.String({ description: "The Workspace to report this agent's own AgentSpace for -- the strict subset of its docked Integrations this agent can actually act on." }),
});

export interface CreateListAgentSpaceToolOptions {
	readonly daemonUrl: string;
	readonly getAllIntegrations: () => readonly IntegrationDefinition[];
	readonly fetcher?: typeof fetch;
}

/**
 * Read-only, per-Workspace, Allowed Write (see the "Reshape list_integrations"
 * Papyrus Task): the strict subset of a Workspace's docked Integrations this
 * agent can actually call -- gated on `capabilities.hasApi`, the exact same
 * check `deriveWorkspaceToolIds` (tool-grant.ts) and `authorizeAgentCommand`
 * (authorize-command.ts) already enforce at grant/dispatch time. AgentSpace
 * subset Workspace always, by construction -- this tool can never report an
 * Integration `list_workspace` itself wouldn't also report as docked.
 *
 * Genuinely new read-facing surface -- `deriveWorkspaceToolIds`'s own real
 * output was never exposed outside the live in-process tool-grant-reactor
 * before this. Needed zero new daemon-side routes, though: the same
 * /api/world `activeIntegrationIds` `list_workspace` already reads, filtered
 * by the same `capabilities.hasApi` this tool's own definitions already
 * carry, is sufficient -- confirmed directly before assuming a new route was
 * required.
 */
export function createListAgentSpaceTool(options: CreateListAgentSpaceToolOptions): ToolDefinition<typeof ListAgentSpaceArgsSchema> {
	const fetcher = options.fetcher ?? fetch;
	return {
		name: "list_agentspace",
		label: "List AgentSpace",
		description: "Read-only: reports the strict subset of this Workspace's docked Integrations this agent can actually act on right now (gated on hasApi) -- narrower than list_workspace's own docked set, which also includes render-only Integrations. Never docks, undocks, or mutates anything.",
		parameters: ListAgentSpaceArgsSchema,
		async execute(_toolCallId, params) {
			const dockedIds = await fetchActiveIntegrationIds(fetcher, options.daemonUrl, params.workspaceId);
			const docked = options.getAllIntegrations().filter((definition) => dockedIds.has(definition.id));
			const agentSpace = deriveAgentSpace(docked);
			return {
				content: [{ type: "text", text: `${agentSpace.items.length} Integration(s) in this agent's own AgentSpace for Workspace "${params.workspaceId}".` }],
				details: { agentSpace },
			};
		},
	};
}
