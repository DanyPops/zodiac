import { createContributionRegistry } from "@alignment/server";
import type { CommandDefinition } from "../commands/registry.js";
import type { SurfaceTemplateDefinition } from "../workspace/surface-templates.js";
import type { AlignmentExtension, AlignmentExtensionAPI, WorkspaceLifecycleEvent } from "./types.js";

export interface ExtensionHost {
	registerExtension: (extension: AlignmentExtension) => void;
	emit: (event: WorkspaceLifecycleEvent) => void;
	surfaceTemplates: () => readonly SurfaceTemplateDefinition[];
	commands: () => readonly CommandDefinition[];
}

/**
 * This app's own specialization of `@alignment/server`'s framework-neutral
 * ContributionRegistry, bound to this app's real Surface Template/command/
 * lifecycle-event shapes. `registerExtension` is this host's own name for
 * the generic engine's `register`, kept for existing callers.
 *
 * The core registry now speaks "Integration" vocabulary
 * (`registerIntegration`/`integrations()`/"Duplicate Integration id"); this
 * app hasn't migrated its own domain naming yet, so each extension's
 * `activate` callback is adapted to still see the app's existing
 * `registerSurfaceTemplate` name and duplicate-id wording -- no observable
 * change for any existing extension.
 */
export function createExtensionHost(): ExtensionHost {
	const registry = createContributionRegistry<SurfaceTemplateDefinition, CommandDefinition, WorkspaceLifecycleEvent>();
	return {
		registerExtension(extension) {
			registry.register({
				id: extension.id,
				activate: (coreApi) => {
					const api: AlignmentExtensionAPI = {
						registerSurfaceTemplate(definition) {
							try {
								coreApi.registerIntegration(definition);
							} catch (error) {
								if (error instanceof Error && /^duplicate integration id:/i.test(error.message)) throw new Error(`Duplicate Surface Template id: ${definition.id}`, { cause: error });
								throw error;
							}
						},
						registerCommand: coreApi.registerCommand,
						on: coreApi.on,
					};
					extension.activate(api);
				},
			});
		},
		emit: registry.emit,
		surfaceTemplates: registry.integrations,
		commands: registry.commands,
	};
}
