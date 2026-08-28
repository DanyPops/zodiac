import { createHash } from "node:crypto";
import { createAgentNavigationResult, extractAgentNavigationAction } from "@zodiac/pi";
import { workspaceId } from "@zodiac/protocol";
import { describe, expect, it, vi } from "vitest";
import type { LectorHost } from "../lector/lector-host.js";
import { createNavigationClientActionHandler, readCurrentLectorContentHash } from "./navigation-client-action.js";

function result(overrides: { workspaceId?: ReturnType<typeof workspaceId> } = {}) {
	return createAgentNavigationResult({
		workspaceId: overrides.workspaceId ?? workspaceId("ws-active"),
		result: {
			ok: true,
			value: {
				summary: "Grounded implementation.",
				resource: { path: "src/state.ts", contentHash: "hash-1" },
				position: { line: 3, character: 2 },
			},
		},
	});
}

function extractAction(output: ReturnType<typeof result>) {
	const action = extractAgentNavigationAction(output);
	if (!action) throw new Error("fixture did not produce an editor action");
	return action;
}

describe("navigation client actions", () => {
	it("freshness follows the exact active buffer snapshot", async () => {
		const host: LectorHost = {
			activate: async () => {},
			dispose: async () => {},
			execute: async (commandId) =>
				commandId === "lector.workspace.open"
					? { ok: true, value: { scheme: "lector", uri: "lector://workspace/ws-active/", kind: "workspace", label: "fixture" } }
					: { ok: true, value: { scheme: "lector", uri: "lector://text/ws-active/src%2Fstate.ts", kind: "text", label: "state.ts" } },
			read: async () => ({ ok: true, value: { content: "dirty snapshot", hash: "saved-disk-hash", dirty: true } }),
		};
		const grounded = extractAction(result());
		const hash = await readCurrentLectorContentHash(host, "/workspace", grounded);
		expect(hash).toBe(createHash("sha256").update("dirty snapshot", "utf8").digest("hex"));
	});
	it("opens one pending, authorized, fresh action", async () => {
		const openEditor = vi.fn();
		const handler = createNavigationClientActionHandler({ activeWorkspaceId: workspaceId("ws-active"), currentContentHash: async () => "hash-1", openEditor });
		handler.observeToolCall("call-1");

		expect(await handler.handleToolCallEnd({ toolCallId: "call-1", output: result(), isError: false })).toMatchObject({ kind: "opened" });
		expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({ position: { line: 3, character: 2 } }));
	});

	it("rejects malformed, replayed, stale, and foreign actions", async () => {
		const openEditor = vi.fn();
		const handler = createNavigationClientActionHandler({ activeWorkspaceId: workspaceId("ws-active"), currentContentHash: async () => "hash-current", openEditor });

		handler.observeToolCall("malformed");
		expect(await handler.handleToolCallEnd({ toolCallId: "malformed", output: { details: { clientActions: [{ type: "editor.open", path: "../escape" }] } }, isError: false })).toEqual({ kind: "rejected", code: "malformed-action" });
		expect(await handler.handleToolCallEnd({ toolCallId: "malformed", output: result(), isError: false })).toEqual({ kind: "rejected", code: "no-pending-action" });
		handler.observeToolCall("oversized");
		expect(await handler.handleToolCallEnd({ toolCallId: "oversized", output: { details: { clientActions: [{ type: "editor.open", path: "x".repeat(1_025) }] } }, isError: false })).toEqual({ kind: "rejected", code: "malformed-action" });
		handler.observeToolCall("unsupported");
		expect(await handler.handleToolCallEnd({ toolCallId: "unsupported", output: { details: { clientActions: [{ type: "shell.execute", command: "pwd" }] } }, isError: false })).toEqual({ kind: "rejected", code: "malformed-action" });
		expect(await handler.handleToolCallEnd({ toolCallId: "missing", output: result(), isError: false })).toEqual({ kind: "rejected", code: "no-pending-action" });

		handler.observeToolCall("stale");
		expect(await handler.handleToolCallEnd({ toolCallId: "stale", output: result(), isError: false })).toEqual({ kind: "rejected", code: "stale-resource" });

		handler.observeToolCall("foreign");
		expect(await handler.handleToolCallEnd({ toolCallId: "foreign", output: result({ workspaceId: workspaceId("ws-foreign") }), isError: false })).toEqual({ kind: "rejected", code: "foreign-workspace" });
		expect(openEditor).not.toHaveBeenCalled();
	});

	it("ignores prose and bounds pending observations", async () => {
		const openEditor = vi.fn();
		const handler = createNavigationClientActionHandler({ activeWorkspaceId: workspaceId("ws-active"), currentContentHash: async () => "hash-1", openEditor });
		for (let index = 0; index < 65; index++) handler.observeToolCall(`call-${index}`);
		expect(await handler.handleToolCallEnd({ toolCallId: "call-0", output: result(), isError: false })).toEqual({ kind: "rejected", code: "no-pending-action" });
		expect(await handler.handleToolCallEnd({ toolCallId: "call-64", output: { content: [{ type: "text", text: "open it" }] }, isError: false })).toEqual({ kind: "ignored" });
		expect(openEditor).not.toHaveBeenCalled();
	});
});
