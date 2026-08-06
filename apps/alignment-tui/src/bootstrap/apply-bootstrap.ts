import { basename } from "node:path";
import type { WorldStore } from "@alignment/core";
import { integrationId, workspaceId } from "@alignment/surface-protocol";
import type { BootstrappedWorkspace } from "./workspace-bootstrap.js";

/**
 * Dispatches a successfully bootstrapped workspace/file into a World through the same typed
 * CommandIntent path a keybinding, a palette entry, or an agent action would use -- never a
 * bespoke direct mutation. The Workspace's own id is the resolved root path: unique per real
 * root the CLI ever opens, and stable across a later CommandIntent replay against the same World.
 */
export function applyBootstrapToWorld(world: WorldStore, bootstrapped: BootstrappedWorkspace): void {
	const id = workspaceId(bootstrapped.rootPath);
	world.apply({ type: "workspace.create", workspaceId: id, title: bootstrapped.rootTitle });
	const surfaceTitle = bootstrapped.kind === "file" && bootstrapped.file ? basename(bootstrapped.file.path) : "Files";
	world.apply({ type: "surface.dock", workspaceId: id, integrationId: integrationId("lector"), title: surfaceTitle });
}
