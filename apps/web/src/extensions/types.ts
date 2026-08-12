import type { CommandDefinition } from "../commands/registry.js";
import type { DockedSurfaceInstance } from "../workspace/model.js";
import type { SurfaceTemplateDefinition } from "../workspace/surface-templates.js";

export type WorkspaceLifecycleEvent =
	| { type: "workspace:selected"; workspaceId: string }
	| { type: "surface:docked"; workspaceId: string; windowId: string; instance: DockedSurfaceInstance }
	| { type: "surface:undocked"; workspaceId: string; surfaceInstanceId: string };

/**
 * Modeled directly on Pi's own ExtensionAPI shape: registerX for
 * build-time-fixed registries, on() for runtime lifecycle events -- this
 * app's own specialization of `@alignment/server`'s framework-neutral
 * ContributionApi, at this app's still-current "Surface Template"
 * vocabulary. Declared as its own interface (not a type alias of
 * ContributionApi) because the core registry now speaks "Integration"
 * vocabulary; extension-host.ts adapts between the two so every existing
 * extension here keeps working unchanged.
 */
export interface AlignmentExtensionAPI {
	registerSurfaceTemplate: (definition: SurfaceTemplateDefinition) => void;
	registerCommand: (definition: CommandDefinition) => void;
	on: <TType extends WorkspaceLifecycleEvent["type"]>(type: TType, handler: (event: Extract<WorkspaceLifecycleEvent, { type: TType }>) => void) => () => void;
}

export interface AlignmentExtension {
	id: string;
	activate: (api: AlignmentExtensionAPI) => void;
}
