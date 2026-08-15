import { createWorldStore } from "@zodiac/server/world";
import { worldId } from "@zodiac/protocol";
import { describe, expect, it } from "vitest";
import { applyBootstrapToWorld } from "./apply-bootstrap.js";
import type { BootstrappedWorkspace } from "./workspace-bootstrap.js";

// A real bootstrap would derive this from Lector's own workspace.registerPath (a SHA-256 digest of
// the resolved absolute path, per deriveWorkspaceId) -- an opaque id, deliberately not a real path,
// so a fixture literal like this exercises the same shape without needing a real Lector daemon.
const OPAQUE_WORKSPACE_ID = "4f9c2a1b7e6d8035";

function directoryBootstrap(rootPath: string): BootstrappedWorkspace {
	return {
		rootPath,
		rootTitle: "project",
		workspaceId: OPAQUE_WORKSPACE_ID,
		workspace: { uri: `lector://workspace/${OPAQUE_WORKSPACE_ID}`, kind: "workspace", title: "project", readOnly: true },
		kind: "directory",
		tree: { path: "", entries: [{ name: "a.ts", kind: "file" }] },
	};
}

function fileBootstrap(rootPath: string): BootstrappedWorkspace {
	return {
		rootPath,
		rootTitle: "project",
		workspaceId: OPAQUE_WORKSPACE_ID,
		workspace: { uri: `lector://workspace/${OPAQUE_WORKSPACE_ID}`, kind: "workspace", title: "project", readOnly: true },
		kind: "file",
		file: { path: "src/a.ts", content: "export const a = 1;\n", resource: { uri: `lector://text/${OPAQUE_WORKSPACE_ID}?path=src%2Fa.ts`, kind: "text", title: "a.ts", readOnly: true } },
	};
}

describe("applyBootstrapToWorld", () => {
	it("creates a Workspace titled after the root and docks a 'Files' Surface for a directory", () => {
		const world = createWorldStore(worldId("zodiac"));
		applyBootstrapToWorld(world, directoryBootstrap("/home/someone/project"));

		const view = world.worldViewModel();
		expect(view).toMatchObject({ state: "ready", activeWorkspaceId: OPAQUE_WORKSPACE_ID });
		if (view.state !== "ready") throw new Error("unreachable");
		expect(view.workspaces[0]).toMatchObject({ id: OPAQUE_WORKSPACE_ID, title: "project" });
		expect(view.workspaces[0]?.windows[0]?.surfaces).toEqual([expect.objectContaining({ integrationId: "lector", title: "Files" })]);
	});

	it("docks a Surface titled after the opened file's own basename for a direct file open", () => {
		const world = createWorldStore(worldId("zodiac"));
		applyBootstrapToWorld(world, fileBootstrap("/home/someone/project"));

		const view = world.worldViewModel();
		if (view.state !== "ready") throw new Error("unreachable");
		expect(view.workspaces[0]?.windows[0]?.surfaces).toEqual([expect.objectContaining({ title: "a.ts" })]);
	});

	it("derives a stable Workspace id from Lector's own opaque workspace id, so WorldStore's own duplicate guard rejects a second bootstrap of the same root", () => {
		const world = createWorldStore(worldId("zodiac"));
		applyBootstrapToWorld(world, directoryBootstrap("/home/someone/project"));
		expect(() => applyBootstrapToWorld(world, directoryBootstrap("/home/someone/project"))).toThrow(/already has a Workspace/);
	});

	it("R1 REWORK regression: the raw absolute rootPath never appears anywhere in the World's own renderer-facing or persisted shape (CWE-200 full-path-disclosure)", () => {
		const world = createWorldStore(worldId("zodiac"));
		const rootPath = "/home/someone/very-real-project";
		applyBootstrapToWorld(world, directoryBootstrap(rootPath));

		const viewJson = JSON.stringify(world.worldViewModel());
		const snapshotJson = JSON.stringify(world.snapshot());
		expect(viewJson).not.toContain(rootPath);
		expect(viewJson).not.toContain("someone");
		expect(snapshotJson).not.toContain(rootPath);
		expect(snapshotJson).not.toContain("someone");
		expect(viewJson).toContain(OPAQUE_WORKSPACE_ID);
	});
});
