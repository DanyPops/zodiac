import { createWorldStore } from "@alignment/core";
import { worldId } from "@alignment/surface-protocol";
import { describe, expect, it } from "vitest";
import { applyBootstrapToWorld } from "./apply-bootstrap.js";
import type { BootstrappedWorkspace } from "./workspace-bootstrap.js";

function directoryBootstrap(rootPath: string): BootstrappedWorkspace {
	return {
		rootPath,
		rootTitle: "project",
		workspace: { uri: "lector://workspace/ws-1", kind: "workspace", title: "project", readOnly: true },
		kind: "directory",
		tree: { path: "", entries: [{ name: "a.ts", kind: "file" }] },
	};
}

function fileBootstrap(rootPath: string): BootstrappedWorkspace {
	return {
		rootPath,
		rootTitle: "project",
		workspace: { uri: "lector://workspace/ws-1", kind: "workspace", title: "project", readOnly: true },
		kind: "file",
		file: { path: "src/a.ts", content: "export const a = 1;\n", resource: { uri: "lector://text/ws-1?path=src%2Fa.ts", kind: "text", title: "a.ts", readOnly: true } },
	};
}

describe("applyBootstrapToWorld", () => {
	it("creates a Workspace titled after the root and docks a 'Files' Surface for a directory", () => {
		const world = createWorldStore(worldId("alignment"));
		applyBootstrapToWorld(world, directoryBootstrap("/tmp/project"));

		const view = world.worldViewModel();
		expect(view).toMatchObject({ state: "ready", activeWorkspaceId: "/tmp/project" });
		if (view.state !== "ready") throw new Error("unreachable");
		expect(view.workspaces[0]).toMatchObject({ title: "project" });
		expect(view.workspaces[0]?.windows[0]?.surfaces).toEqual([expect.objectContaining({ integrationId: "lector", title: "Files" })]);
	});

	it("docks a Surface titled after the opened file's own basename for a direct file open", () => {
		const world = createWorldStore(worldId("alignment"));
		applyBootstrapToWorld(world, fileBootstrap("/tmp/project"));

		const view = world.worldViewModel();
		if (view.state !== "ready") throw new Error("unreachable");
		expect(view.workspaces[0]?.windows[0]?.surfaces).toEqual([expect.objectContaining({ title: "a.ts" })]);
	});

	it("derives a stable Workspace id from the root path, so WorldStore's own duplicate guard rejects a second bootstrap of the same root", () => {
		const world = createWorldStore(worldId("alignment"));
		applyBootstrapToWorld(world, directoryBootstrap("/tmp/project"));
		expect(() => applyBootstrapToWorld(world, directoryBootstrap("/tmp/project"))).toThrow(/already has a Workspace/);
	});
});
