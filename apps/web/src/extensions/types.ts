import type { ContributionProvenance } from "@zodiac/protocol";
import type { CommandDefinition } from "../commands/registry.js";
import type { DockedSurfaceInstance } from "../workspace/model.js";
import type { SurfaceTemplateDefinition } from "../workspace/surface-templates.js";

export type WorkspaceLifecycleEvent =
	| { type: "workspace:selected"; workspaceId: string }
	| { type: "workspace:removed"; workspaceId: string }
	| { type: "surface:docked"; workspaceId: string; windowId: string; instance: DockedSurfaceInstance }
	| { type: "surface:undocked"; workspaceId: string; surfaceInstanceId: string };

/**
 * Modeled directly on Pi's own ExtensionAPI shape: registerX for
 * build-time-fixed registries, on() for runtime lifecycle events -- this
 * app's own specialization of `@zodiac/server`'s framework-neutral
 * ContributionApi. Browser-owned Integration definitions retain their React
 * renderers, but registration uses the platform's shared Integration
 * vocabulary instead of a second Surface Template contribution taxonomy.
 */
export interface ZodiacExtensionAPI {
	registerIntegration: (definition: SurfaceTemplateDefinition) => void;
	registerCommand: (definition: CommandDefinition) => void;
	on: <TType extends WorkspaceLifecycleEvent["type"]>(type: TType, handler: (event: Extract<WorkspaceLifecycleEvent, { type: TType }>) => void) => () => void;
}

export interface ZodiacExtension {
	id: string;
	provenance?: ContributionProvenance;
	activate: (api: ZodiacExtensionAPI) => void;
}
