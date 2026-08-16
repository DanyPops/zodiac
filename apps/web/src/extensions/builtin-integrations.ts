import { createContributionRegistry } from "@zodiac/server";
import type { IntegrationDefinition } from "@zodiac/protocol";
import { SURFACE_TEMPLATE_REGISTRY } from "../workspace/surface-templates.js";

/**
 * The real IntegrationDefinition matching each built-in Surface Template
 * (Activity, Terminal), registered through the same createContributionRegistry
 * machinery a real package contribution uses. `hasApi: false` for both --
 * neither exposes any CommandIntent-dispatchable behavior beyond docking.
 * Scoped to identity/registration only; not unified with any daemon-side
 * Integration registry (see the mock-Workspace-catalog epic).
 */
const registry = createContributionRegistry<IntegrationDefinition, { id: string }, { type: string }>();
registry.register({
	id: "builtin-surface-templates",
	activate: (api) => {
		for (const template of SURFACE_TEMPLATE_REGISTRY) {
			api.registerIntegration({ id: template.integrationId, title: template.title, capabilities: { renderable: true, hasApi: false } });
		}
	},
});

export const BUILTIN_INTEGRATION_DEFINITIONS: readonly IntegrationDefinition[] = registry.integrations();

export function findBuiltinIntegrationDefinition(id: string): IntegrationDefinition | undefined {
	return BUILTIN_INTEGRATION_DEFINITIONS.find((definition) => definition.id === id);
}
