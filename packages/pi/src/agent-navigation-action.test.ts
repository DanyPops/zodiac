import { workspaceId } from "@zodiac/protocol";
import { describe, expect, it } from "vitest";
import { createAgentNavigationResult, extractAgentNavigationAction } from "./agent-navigation-action.js";

const action = {
	version: 1 as const,
	type: "editor.open" as const,
	workspaceId: workspaceId("ws-1"),
	resource: { integrationId: "lector" as const, path: "src/state.ts", contentHash: "sha256:abc" },
	position: { line: 12, character: 4 },
};

describe("agent navigation actions", () => {
	it("keeps evidence model-visible and emits one typed action", () => {
		const result = createAgentNavigationResult({
			workspaceId: workspaceId("ws-1"),
			result: {
				ok: true,
				value: {
					summary: "The selected implementation mutates state here.",
					resource: { path: "src/state.ts", contentHash: "sha256:abc" },
					position: { line: 12, character: 4 },
					provenance: { operation: "workspace.goToDefinition", symbol: "applyState" },
				},
			},
		});

		expect(result.content).toEqual([{ type: "text", text: "The selected implementation mutates state here." }]);
		expect(extractAgentNavigationAction(result)).toEqual(action);
	});

	it("rejects prose and malformed action-shaped details", () => {
		expect(extractAgentNavigationAction({ content: [{ type: "text", text: "open src/state.ts" }], details: {} })).toBeUndefined();
		expect(
			extractAgentNavigationAction({
				content: [{ type: "text", text: "grounded" }],
				details: { evidence: { summary: "grounded" }, clientActions: [{ ...action, resource: { ...action.resource, path: "../foreign.ts" } }] },
			}),
		).toBeUndefined();
	});
});
