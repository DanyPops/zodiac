import type { CommandDefinition } from "../commands/registry.js";
import type { DockedSurfaceInstance } from "../workspace/model.js";
import type { SurfaceTemplateDefinition } from "../workspace/surface-templates.js";

export type WorkspaceLifecycleEvent =
	| { type: "workspace:selected"; workspaceId: string }
	| { type: "surface:docked"; workspaceId: string; windowId: string; instance: DockedSurfaceInstance }
	| { type: "surface:undocked"; workspaceId: string; surfaceInstanceId: string };

/** Modeled directly on Pi's own ExtensionAPI shape: registerX for build-time-fixed registries, on() for runtime lifecycle events. */
export interface AlignmentExtensionAPI {
	registerSurfaceTemplate: (definition: SurfaceTemplateDefinition) => void;
	registerCommand: (definition: CommandDefinition) => void;
	on: <T extends WorkspaceLifecycleEvent["type"]>(type: T, handler: (event: Extract<WorkspaceLifecycleEvent, { type: T }>) => void) => () => void;
}

export interface AlignmentExtension {
	id: string;
	activate: (api: AlignmentExtensionAPI) => void;
}
