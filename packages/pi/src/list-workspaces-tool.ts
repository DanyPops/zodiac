import { summarizeWorkspaces } from "@zodiac/server/agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchWorkspaceSummaries } from "./world-snapshot.js";

const ListWorkspacesArgsSchema = Type.Object({});

export interface CreateListWorkspacesToolOptions {
	/** Same daemon this session's other world-reading tools target -- this tool only ever GETs /api/world. */
	readonly daemonUrl: string;
	/** Overridable for tests; defaults to the real global fetch. */
	readonly fetcher?: typeof fetch;
}

/**
 * Read-only, global: which Workspaces exist at all (id/title), independent
 * of what's docked in any one of them -- see the "Reshape list_integrations"
 * Papyrus Task's own real domain model (Workspace/AgentSpace, both
 * genuinely distinct from "which Workspaces exist"). Zero new daemon-side
 * surface -- the existing /api/world snapshot already carries this.
 */
export function createListWorkspacesTool(options: CreateListWorkspacesToolOptions): ToolDefinition<typeof ListWorkspacesArgsSchema> {
	const fetcher = options.fetcher ?? fetch;
	return {
		name: "list_workspaces",
		label: "List Workspaces",
		description: "Read-only, global: reports every Workspace that currently exists (id and title), independent of what's docked in any one of them. Never mutates anything.",
		parameters: ListWorkspacesArgsSchema,
		async execute() {
			const workspaces = await fetchWorkspaceSummaries(fetcher, options.daemonUrl);
			const summary = summarizeWorkspaces(workspaces);
			return {
				content: [{ type: "text", text: `${summary.length} Workspace(s) currently exist.` }],
				details: { workspaces: summary },
			};
		},
	};
}
