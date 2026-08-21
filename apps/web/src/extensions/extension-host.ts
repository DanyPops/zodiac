import type { ContributionPointDefinition, ContributionProvenance } from "@zodiac/protocol";
import { createContributionPointRegistry, createContributionRegistry, type RegisteredContribution } from "@zodiac/server";
import type { CommandDefinition } from "../commands/registry.js";
import type { SurfaceTemplateDefinition } from "../workspace/surface-templates.js";
import type { ZodiacExtension, ZodiacExtensionAPI, WorkspaceLifecycleEvent } from "./types.js";

export interface ExtensionHost {
	registerExtension: (extension: ZodiacExtension) => void;
	emit: (event: WorkspaceLifecycleEvent) => void;
	surfaceTemplates: () => readonly SurfaceTemplateDefinition[];
	commands: () => readonly CommandDefinition[];
	integrationRegistrations: () => readonly RegisteredContribution<RegisteredSurfaceTemplate>[];
}

/** Bridges SurfaceTemplateDefinition's own `integrationId` field to the shared point registry's plain `id` key. */
type RegisteredSurfaceTemplate = SurfaceTemplateDefinition & { id: string };
interface BrowserContributionPoints { integration: RegisteredSurfaceTemplate }
const INTEGRATION_POINT = { kind: "integration", cardinality: "zero-or-many" } as const satisfies ContributionPointDefinition<"integration">;

function provenanceOf(extension: ZodiacExtension): ContributionProvenance {
	return extension.provenance ?? { packageId: extension.id, version: "0.0.0", source: `builtin:web-extension:${extension.id}` };
}

/**
 * This app's own specialization of `@zodiac/server`'s framework-neutral
 * ContributionRegistry, bound to this app's real Surface Template/command/
 * lifecycle-event shapes. `registerExtension` is this host's own name for
 * the generic engine's `register`, kept for existing callers.
 *
 * Browser renderers remain host-owned values, but use the same generic named
 * point/cardinality/provenance registry as daemon-side applets and editors.
 */
export function createExtensionHost(): ExtensionHost {
	const registry = createContributionRegistry<RegisteredSurfaceTemplate, CommandDefinition, WorkspaceLifecycleEvent>();
	const points = createContributionPointRegistry<BrowserContributionPoints>([INTEGRATION_POINT]);
	return {
		registerExtension(extension) {
			registry.register({
				id: extension.id,
				activate: (coreApi) => {
					const api: ZodiacExtensionAPI = {
						registerIntegration(definition) {
							points.register("integration", { ...definition, id: definition.integrationId }, provenanceOf(extension));
						},
						registerCommand: coreApi.registerCommand,
						on: coreApi.on,
					};
					extension.activate(api);
				},
			});
		},
		emit: registry.emit,
		surfaceTemplates: () => points.entries("integration").map((entry) => entry.value),
		commands: registry.commands,
		integrationRegistrations: () => points.entries("integration"),
	};
}
