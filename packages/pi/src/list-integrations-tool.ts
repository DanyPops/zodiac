import { describeIntegrationCatalog, type IntegrationSummary } from "@zodiac/server/agent";
import type { IntegrationDefinition } from "@zodiac/protocol";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const ListIntegrationsArgsSchema = Type.Object({
	includeDiscoverable: Type.Optional(Type.Boolean({ description: "Also look up Packed-registry-discoverable-but-not-installed Integrations -- a real network call, so only ever opt in when actually deciding whether to suggest installing something new." })),
});

export interface CreateListIntegrationsToolOptions {
	readonly getAllIntegrations: () => readonly IntegrationDefinition[];
	/** Real Packed registry lookup, injected -- omitted (the production default today, since Packed isn't yet wired into zodiacd) means includeDiscoverable is always a no-op, never a silent background call. */
	readonly discoverRegistryIntegrations?: () => Promise<readonly IntegrationSummary[]>;
}

/**
 * Read-only, global, Workspace-independent: the full Integration catalog
 * this Zodiac install knows about, plus (opt-in) which are registry-
 * discoverable but not installed. Never docks, installs, or mutates
 * anything.
 *
 * Reshaped (see the "Reshape list_integrations" Papyrus Task) from its own
 * original shape, which conflated two genuinely different questions: "what
 * Integrations exist at all" (this tool, now) vs. "what's docked in this one
 * Workspace" (list_workspace, now a separate tool) -- checked directly
 * against this repository's own real domain model
 * (deriveWorkspaceToolIds/authorizeAgentCommand): a Workspace's docked set
 * and the global catalog are genuinely different scopes, and no existing
 * real caller needed them conflated. A breaking reshape, not an additive
 * split -- confirmed safe: no real, shipped production caller depended on
 * the old workspaceId-scoped shape at the time of this change (2454943d,
 * its own only referenced consumer, was never implemented).
 */
export function createListIntegrationsTool(options: CreateListIntegrationsToolOptions): ToolDefinition<typeof ListIntegrationsArgsSchema> {
	return {
		name: "list_integrations",
		label: "List Integrations",
		description: "Read-only, global: reports the full Integration catalog this Zodiac install knows about (not scoped to any one Workspace), and (opt-in) which are discoverable but not installed. Never docks, installs, or mutates anything. Use list_workspace to see what's docked in a specific Workspace, or list_agentspace to see what this agent can actually act on there.",
		parameters: ListIntegrationsArgsSchema,
		async execute(_toolCallId, params) {
			const catalog = describeIntegrationCatalog(options.getAllIntegrations());
			const discoverable = params.includeDiscoverable && options.discoverRegistryIntegrations ? await options.discoverRegistryIntegrations() : undefined;
			const summaryText = `${catalog.items.length} Integration(s) known to this Zodiac install${discoverable ? `, ${discoverable.length} discoverable` : ""}.`;
			return {
				content: [{ type: "text", text: summaryText }],
				details: { catalog, ...(discoverable ? { discoverable } : {}) },
			};
		},
	};
}
