import { listIntegrations, type IntegrationSummary } from "@zodiac/server/agent";
import type { IntegrationDefinition } from "@zodiac/protocol";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchActiveIntegrationIds } from "./world-snapshot.js";

const ListIntegrationsArgsSchema = Type.Object({
	workspaceId: Type.String({ description: "The Workspace to report Integrations for." }),
	includeDiscoverable: Type.Optional(Type.Boolean({ description: "Also look up Packed-registry-discoverable-but-not-installed Integrations -- a real network call, so only ever opt in when actually deciding whether to suggest installing something new." })),
});

export interface CreateListIntegrationsToolOptions {
	/** Same daemon this session's zodiac_dispatch_command targets -- this tool only ever GETs /api/world, never posts a command. */
	readonly daemonUrl: string;
	readonly getAllIntegrations: () => readonly IntegrationDefinition[];
	/** Overridable for tests; defaults to the real global fetch. */
	readonly fetcher?: typeof fetch;
	/** Real Packed registry lookup, injected -- omitted (the production default today, since Packed isn't yet wired into zodiacd) means includeDiscoverable is always a no-op, never a silent background call. */
	readonly discoverRegistryIntegrations?: () => Promise<readonly IntegrationSummary[]>;
}

/**
 * Read-only: reports which Integrations are docked in a Workspace, which
 * are installed but not docked, and (opt-in) which are registry-
 * discoverable but not installed. Never docks, installs, or mutates
 * anything -- see integration-directory.ts for the pure partition/redaction
 * logic this wraps with a live /api/world fetch.
 */
export function createListIntegrationsTool(options: CreateListIntegrationsToolOptions): ToolDefinition<typeof ListIntegrationsArgsSchema> {
	const fetcher = options.fetcher ?? fetch;
	return {
		name: "list_integrations",
		label: "List Integrations",
		description: "Read-only: reports which Integrations are docked in this Workspace, which are installed but not docked, and (opt-in) which are discoverable but not installed. Never docks, installs, or mutates anything.",
		parameters: ListIntegrationsArgsSchema,
		async execute(_toolCallId, params) {
			const dockedIds = await fetchActiveIntegrationIds(fetcher, options.daemonUrl, params.workspaceId);
			const listing = listIntegrations(options.getAllIntegrations(), dockedIds);
			const discoverable = params.includeDiscoverable && options.discoverRegistryIntegrations ? await options.discoverRegistryIntegrations() : undefined;
			const summaryText = `${listing.docked.items.length} docked, ${listing.undocked.items.length} installed-but-undocked${discoverable ? `, ${discoverable.length} discoverable` : ""} Integration(s) in Workspace "${params.workspaceId}".`;
			return {
				content: [{ type: "text", text: summaryText }],
				details: { docked: listing.docked, undocked: listing.undocked, ...(discoverable ? { discoverable } : {}) },
			};
		},
	};
}
