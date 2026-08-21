import type { ContributionPointDefinition, IntegrationDefinition } from "@zodiac/protocol";
import { createContributionPointRegistry } from "@zodiac/server";
import { SURFACE_TEMPLATE_REGISTRY } from "../workspace/surface-templates.js";

/**
 * The real IntegrationDefinition matching each built-in Surface Template
 * (Activity, Terminal), registered through the same createContributionRegistry
 * machinery a real package contribution uses. `hasApi: false` for both --
 * neither exposes any CommandIntent-dispatchable behavior beyond docking.
 * Scoped to identity/registration only; not unified with any daemon-side
 * Integration registry (see the mock-Workspace-catalog epic).
 */
interface BrowserIntegrationPoints { integration: IntegrationDefinition }
const INTEGRATION_POINT = { kind: "integration", cardinality: "zero-or-many" } as const satisfies ContributionPointDefinition<"integration">;
const registry = createContributionPointRegistry<BrowserIntegrationPoints>([INTEGRATION_POINT]);
for (const template of SURFACE_TEMPLATE_REGISTRY) {
	registry.register(
		"integration",
		{ id: template.integrationId, title: template.title, capabilities: { renderable: true, hasApi: false } },
		{ packageId: "@zodiac/web", version: "0.0.1", source: "builtin:@zodiac/web" },
	);
}

export const BUILTIN_INTEGRATION_DEFINITIONS: readonly IntegrationDefinition[] = registry.entries("integration").map((entry) => entry.value);

export function findBuiltinIntegrationDefinition(id: string): IntegrationDefinition | undefined {
	return BUILTIN_INTEGRATION_DEFINITIONS.find((definition) => definition.id === id);
}
