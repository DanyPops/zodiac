import type { ServerResponse } from "node:http";
import { workspaceId as makeWorkspaceId, type WorkspaceId } from "@zodiac/protocol";

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(body));
}

/** Diagnostic read of a Workspace's live agent tool grant -- see packages/server/src/agent/tool-grant-reactor.ts. */
export function createToolGrantRoutes(getWorkspaceToolIds: (workspaceId: WorkspaceId) => readonly string[]) {
	return {
		getWorkspaceTools(rawWorkspaceId: string, res: ServerResponse): void {
			writeJson(res, 200, { toolIds: getWorkspaceToolIds(makeWorkspaceId(rawWorkspaceId)) });
		},
	};
}
