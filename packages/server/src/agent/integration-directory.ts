import { isVehicleCredentialFieldName } from "@danypops/vehicle-core";
import type { IntegrationDefinition, IntegrationId, WorkspaceId } from "@zodiac/protocol";

/** Caps how many Integrations one list_integrations call reports -- bounds the tool's own output, not a UI pagination concern. */
export const MAX_LISTED_INTEGRATIONS = 50;
/** Caps one Integration's own summary text -- reuses the "bound resources and outputs explicitly" discipline this codebase already applies to Footer history/scrollback. */
export const MAX_SUMMARY_BYTES = 200;

export interface IntegrationSummary {
	readonly id: IntegrationId;
	readonly title: string;
	readonly summary: string;
}

/** One capped, explicitly-typed bucket -- `truncated`/`totalCount` make an overflow visible to a caller instead of silently dropping entries with no signal. */
export interface IntegrationBucket {
	readonly items: readonly IntegrationSummary[];
	readonly truncated: boolean;
	readonly totalCount: number;
}

export interface ListIntegrationsResult {
	readonly docked: IntegrationBucket;
	readonly undocked: IntegrationBucket;
}

function truncateBytes(text: string, maxBytes: number): string {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	let end = maxBytes;
	while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) end--;
	return text.slice(0, end);
}

/**
 * Reads only fields whose own key isn't credential-shaped (reuses
 * @danypops/vehicle-core's own VEHICLE_CREDENTIAL_FIELD_NAMES vocabulary,
 * the same list Vehicle's own pino redaction is built from) -- defends the
 * summary this builds even if a future, richer IntegrationDefinition ever
 * carries a stray secret-shaped field. One level deep only: today's schema
 * ({id, title, capabilities}) has no nesting worth guarding further; a
 * deeper shape would need Vehicle's own full recursive redactor instead.
 */
function safeFieldsOf(definition: IntegrationDefinition): Record<string, unknown> {
	const raw = definition as unknown as Record<string, unknown>;
	const safe: Record<string, unknown> = {};
	for (const key of Object.keys(raw)) {
		if (isVehicleCredentialFieldName(key)) continue;
		safe[key] = raw[key];
	}
	return safe;
}

function summarize(definition: IntegrationDefinition): string {
	const parts: string[] = [];
	if (definition.capabilities.renderable) parts.push("renders content");
	if (definition.capabilities.hasApi) parts.push("exposes an API agents can call");
	return truncateBytes(parts.length > 0 ? parts.join("; ") : "no declared capabilities", MAX_SUMMARY_BYTES);
}

function toBucket(definitions: readonly IntegrationDefinition[]): IntegrationBucket {
	const items = definitions.slice(0, MAX_LISTED_INTEGRATIONS).map((definition) => {
		const safe = safeFieldsOf(definition);
		return { id: definition.id, title: typeof safe["title"] === "string" ? safe["title"] : definition.title, summary: summarize(definition) };
	});
	return { items, truncated: definitions.length > MAX_LISTED_INTEGRATIONS, totalCount: definitions.length };
}

/**
 * Pure partition + redaction + capping -- no daemon/HTTP dependency, so this
 * is unit-testable in isolation from list-workspace-tool.ts's own fetch
 * plumbing. Backs `list_workspace` -- see the "Reshape list_integrations"
 * Papyrus Task for why this moved out of a Workspace-scoped
 * `list_integrations` (this repository's own real domain model: Workspace
 * = everything docked, regardless of hasApi).
 */
export function listIntegrations(all: readonly IntegrationDefinition[], dockedIds: ReadonlySet<IntegrationId>): ListIntegrationsResult {
	const docked: IntegrationDefinition[] = [];
	const undocked: IntegrationDefinition[] = [];
	for (const definition of all) (dockedIds.has(definition.id) ? docked : undocked).push(definition);
	return { docked: toBucket(docked), undocked: toBucket(undocked) };
}

/** Backs the reshaped, Workspace-independent `list_integrations`: the full Integration catalog this Zodiac install knows about, no docked/undocked partition at all -- that partition is now `list_workspace`'s own job. */
export function describeIntegrationCatalog(all: readonly IntegrationDefinition[]): IntegrationBucket {
	return toBucket(all);
}

/**
 * Backs `list_agentspace`: the strict subset of a Workspace's docked
 * Integrations the agent can actually act on -- gated on `capabilities.hasApi`,
 * the exact same check `deriveWorkspaceToolIds` (tool-grant.ts) and
 * `authorizeAgentCommand` (authorize-command.ts) already apply. AgentSpace
 * subset Workspace always, by construction: this function only ever removes
 * entries from `docked`, never adds any.
 */
export function deriveAgentSpace(docked: readonly IntegrationDefinition[]): IntegrationBucket {
	return toBucket(docked.filter((definition) => definition.capabilities.hasApi));
}

export interface WorkspaceSummary {
	readonly id: WorkspaceId;
	readonly title: string;
}

/** Backs `list_workspaces`: which Workspaces exist at all, global, not scoped to any one of them -- id/title only, the same minimal shape a Workspace-picker UI needs, never the full docked-Surface tree. */
export function summarizeWorkspaces(workspaces: readonly { readonly id: WorkspaceId; readonly title: string }[]): readonly WorkspaceSummary[] {
	return workspaces.map((workspace) => ({ id: workspace.id, title: workspace.title }));
}
