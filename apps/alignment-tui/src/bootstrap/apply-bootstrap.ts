import { basename } from "node:path";
import type { WorldStore } from "@alignment/core";
import { integrationId, workspaceId } from "@alignment/surface-protocol";
import type { BootstrappedWorkspace } from "./workspace-bootstrap.js";

/**
 * Dispatches a successfully bootstrapped workspace/file into a World through the same typed
 * CommandIntent path a keybinding, a palette entry, or an agent action would use -- never a
 * bespoke direct mutation. The Workspace's own id is Lector's own opaque, content-derived
 * workspace identity (never the raw absolute rootPath) -- WorldViewModel/world.snapshot() are
 * shared, potentially browser-facing projections, and a real absolute filesystem path leaking
 * into them is a Full Path Disclosure (CWE-200): it reveals OS username and directory layout to
 * whatever eventually consumes that projection. Still unique per real root and stable across a
 * later CommandIntent replay, since Lector derives it deterministically from the resolved path.
 */
export function applyBootstrapToWorld(world: WorldStore, bootstrapped: BootstrappedWorkspace): void {
	const id = workspaceId(bootstrapped.workspaceId);
	world.apply({ type: "workspace.create", workspaceId: id, title: bootstrapped.rootTitle });
	const surfaceTitle = bootstrapped.kind === "file" && bootstrapped.file ? basename(bootstrapped.file.path) : "Files";
	world.apply({ type: "surface.dock", workspaceId: id, integrationId: integrationId("lector"), title: surfaceTitle });
}
