import { listIntegrations } from "@zodiac/server/agent";
import type { IntegrationDefinition } from "@zodiac/protocol";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchActiveIntegrationIds } from "./world-snapshot.js";

const ListWorkspaceArgsSchema = Type.Object({
	workspaceId: Type.String({ description: "The Workspace to report docked/undocked Integrations for." }),
});

export interface CreateListWorkspaceToolOptions {
	readonly daemonUrl: string;
	readonly getAllIntegrations: () => readonly IntegrationDefinition[];
	readonly fetcher?: typeof fetch;
}

/**
 * Read-only, per-Workspace, Allowed Read (see the "Reshape list_integrations"
 * Papyrus Task): what's docked in `workspaceId` and what's installed but
 * not docked there -- exactly `dbed439e`'s own original `list_integrations`
 * shape, relocated here unchanged (reuses `listIntegrations`'s own pure
 * partition function verbatim). Deliberately reports the *docked* set
 * regardless of `capabilities.hasApi` -- a render-only Integration is a
 * real part of this Workspace even though the agent can't call it; see
 * `list_agentspace` for the further hasApi-gated subset.
 */
export function createListWorkspaceTool(options: CreateListWorkspaceToolOptions): ToolDefinition<typeof ListWorkspaceArgsSchema> {
	const fetcher = options.fetcher ?? fetch;
	return {
		name: "list_workspace",
		label: "List Workspace",
		description: "Read-only: reports which Integrations are docked in this Workspace, and which are installed but not docked there. Includes render-only Integrations the agent can't itself act on -- see list_agentspace for the further subset it actually can. Never docks, undocks, or mutates anything.",
		parameters: ListWorkspaceArgsSchema,
		async execute(_toolCallId, params) {
			const dockedIds = await fetchActiveIntegrationIds(fetcher, options.daemonUrl, params.workspaceId);
			const listing = listIntegrations(options.getAllIntegrations(), dockedIds);
			const summaryText = `${listing.docked.items.length} docked, ${listing.undocked.items.length} installed-but-undocked Integration(s) in Workspace "${params.workspaceId}".`;
			return {
				content: [{ type: "text", text: summaryText }],
				details: { docked: listing.docked, undocked: listing.undocked },
			};
		},
	};
}
