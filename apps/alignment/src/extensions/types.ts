import type { Contribution, ContributionApi } from "@alignment/core";
import type { CommandDefinition } from "../commands/registry.js";
import type { DockedSurfaceInstance } from "../workspace/model.js";
import type { SurfaceTemplateDefinition } from "../workspace/surface-templates.js";

export type WorkspaceLifecycleEvent =
	| { type: "workspace:selected"; workspaceId: string }
	| { type: "surface:docked"; workspaceId: string; windowId: string; instance: DockedSurfaceInstance }
	| { type: "surface:undocked"; workspaceId: string; surfaceInstanceId: string };

/** Modeled directly on Pi's own ExtensionAPI shape: registerX for build-time-fixed registries, on() for runtime lifecycle events -- Alignment's own specialization of `@alignment/core`'s framework-neutral ContributionApi. */
export type AlignmentExtensionAPI = ContributionApi<SurfaceTemplateDefinition, CommandDefinition, WorkspaceLifecycleEvent>;

export type AlignmentExtension = Contribution<SurfaceTemplateDefinition, CommandDefinition, WorkspaceLifecycleEvent>;
