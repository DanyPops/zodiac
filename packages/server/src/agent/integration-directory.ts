import { isVehicleCredentialFieldName } from "@danypops/vehicle-core";
import type { IntegrationDefinition, IntegrationId } from "@zodiac/protocol";

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

/** Pure partition + redaction + capping -- no daemon/HTTP dependency, so this is unit-testable in isolation from list-integrations-tool.ts's own fetch plumbing. */
export function listIntegrations(all: readonly IntegrationDefinition[], dockedIds: ReadonlySet<IntegrationId>): ListIntegrationsResult {
	const docked: IntegrationDefinition[] = [];
	const undocked: IntegrationDefinition[] = [];
	for (const definition of all) (dockedIds.has(definition.id) ? docked : undocked).push(definition);
	return { docked: toBucket(docked), undocked: toBucket(undocked) };
}
