import { integrationId, type ContributionDescription, type ContributionPointKind, type IntegrationDefinition } from "@zodiac/protocol";
import type { IntegrationInvokeHandler } from "../world/store.js";
import { invokeContributionCommand, type ContributionInvokeRegistry } from "./contribution-invoke.js";

/**
 * The well-known ContributionCapability tag a loaded editor/applet
 * contribution declares to opt into `integration.invoke` -- an agent (or
 * any other CommandIntent dispatcher) may call its commands, subject to the
 * same per-Workspace tool grant and authorizeAgentCommand gate every other
 * agent-issued command goes through. Absent (or any other capability
 * string) means hasApi: false -- no first-party contribution gets this for
 * free, the same enforced boundary a third-party one goes through.
 */
export const AGENT_INVOKABLE_CAPABILITY = "agent-invokable";

/**
 * Projects loaded editor/applet/vehicle-loopback contribution entries into
 * the IntegrationDefinition shape the tool-grant/authorizeAgentCommand
 * system reads `capabilities.hasApi` from. A vehicle-surface entry is
 * excluded -- that kind has its own separate Integration story (see
 * vehicleSurfaceDefinitionsFrom) and never docks into a Window as a
 * Surface.
 */
export function integrationDefinitionsFrom(entries: readonly { readonly id: string; readonly kind: ContributionPointKind; readonly description?: ContributionDescription }[]): IntegrationDefinition[] {
	return entries
		.filter((entry) => entry.kind === "editor" || entry.kind === "applet" || entry.kind === "vehicle-loopback")
		.map((entry) => ({
			id: integrationId(entry.id),
			title: entry.description?.title ?? entry.id,
			capabilities: { renderable: true, hasApi: entry.description?.capabilities?.includes(AGENT_INVOKABLE_CAPABILITY) ?? false },
		}));
}

/** Bridges a WorldStore.registerIntegrationInvokeHandler registration to invokeContributionCommand's own registry-backed lookup -- the mechanism an agent-invokable contribution's real commands actually run through. */
export function createContributionInvokeHandler(contributionId: string, registry: ContributionInvokeRegistry): IntegrationInvokeHandler {
	return (action, input) => invokeContributionCommand(contributionId, action, input, registry);
}
