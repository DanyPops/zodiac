import { createContributionRegistry } from "@alignment/core";
import type { CommandDefinition } from "../commands/registry.js";
import type { SurfaceTemplateDefinition } from "../workspace/surface-templates.js";
import type { AlignmentExtension, WorkspaceLifecycleEvent } from "./types.js";

export interface ExtensionHost {
	registerExtension: (extension: AlignmentExtension) => void;
	emit: (event: WorkspaceLifecycleEvent) => void;
	surfaceTemplates: () => readonly SurfaceTemplateDefinition[];
	commands: () => readonly CommandDefinition[];
}

/**
 * Alignment's own specialization of `@alignment/core`'s framework-neutral
 * ContributionRegistry, bound to this app's real Surface Template/command/
 * lifecycle-event shapes. `registerExtension` is this host's own name for
 * the generic engine's `register`, kept for existing callers.
 */
export function createExtensionHost(): ExtensionHost {
	const registry = createContributionRegistry<SurfaceTemplateDefinition, CommandDefinition, WorkspaceLifecycleEvent>();
	return {
		registerExtension: registry.register,
		emit: registry.emit,
		surfaceTemplates: registry.surfaceTemplates,
		commands: registry.commands,
	};
}
