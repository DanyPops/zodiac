import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { extractAgentNavigationAction } from "@zodiac/pi";
import type { ContributionReadBounds, EditorOpenClientAction, WorkspaceId } from "@zodiac/protocol";
import { resolveNativeEditorTarget } from "../lector/native-editor.js";
import type { LectorHost } from "../lector/lector-host.js";

const MAX_PENDING_NAVIGATION_CALLS = 64;
const MAX_TOOL_CALL_ID_BYTES = 200;
const HASH_READ_BOUNDS: ContributionReadBounds = { maxBytes: 4 * 1024 * 1024, maxEntries: 10_000 };

export type NavigationClientActionOutcome =
	| { readonly kind: "ignored" }
	| { readonly kind: "opened"; readonly action: EditorOpenClientAction }
	| { readonly kind: "rejected"; readonly code: "malformed-action" | "no-pending-action" | "foreign-workspace" | "stale-resource" };

export async function readCurrentLectorContentHash(lectorHost: LectorHost, activeRootPath: string, action: EditorOpenClientAction): Promise<string | undefined> {
	const absolutePath = resolve(activeRootPath, action.resource.path);
	const target = await resolveNativeEditorTarget(lectorHost, absolutePath, activeRootPath);
	if (!target.ok) return undefined;
	const opened = await lectorHost.execute("lector.file.open", { workspaceId: target.value.workspaceId, path: target.value.relativePath });
	if (!opened.ok) return undefined;
	const read = await lectorHost.read(opened.value, HASH_READ_BOUNDS);
	if (!read.ok || typeof read.value !== "object" || read.value === null) return undefined;
	const content: unknown = Reflect.get(read.value, "content");
	return typeof content === "string" ? createHash("sha256").update(content, "utf8").digest("hex") : undefined;
}

function hasClientActionCandidate(output: unknown): boolean {
	if (typeof output !== "object" || output === null) return false;
	const details: unknown = Reflect.get(output, "details");
	return typeof details === "object" && details !== null && Reflect.has(details, "clientActions");
}

export interface NavigationClientActionHandler {
	observeToolCall(toolCallId: string): void;
	handleToolCallEnd(event: { readonly toolCallId: string; readonly output: unknown; readonly isError: boolean }): Promise<NavigationClientActionOutcome>;
}

/** Validates, re-authorizes, freshness-checks, and executes editor actions observed on the agent event stream. */
export function createNavigationClientActionHandler(options: {
	readonly activeWorkspaceId: WorkspaceId;
	readonly currentContentHash: (action: EditorOpenClientAction) => Promise<string | undefined>;
	readonly openEditor: (action: EditorOpenClientAction) => void | Promise<void>;
}): NavigationClientActionHandler {
	const pending = new Set<string>();

	return {
		observeToolCall(toolCallId) {
			if (!toolCallId || toolCallId.length > MAX_TOOL_CALL_ID_BYTES) return;
			pending.add(toolCallId);
			while (pending.size > MAX_PENDING_NAVIGATION_CALLS) pending.delete(pending.values().next().value!);
		},
		async handleToolCallEnd(event) {
			const wasPending = pending.delete(event.toolCallId);
			const hasCandidate = hasClientActionCandidate(event.output);
			const action = event.isError ? undefined : extractAgentNavigationAction(event.output);
			if (!action) return hasCandidate ? { kind: "rejected", code: "malformed-action" } : { kind: "ignored" };
			if (!wasPending) return { kind: "rejected", code: "no-pending-action" };
			if (action.workspaceId !== options.activeWorkspaceId) return { kind: "rejected", code: "foreign-workspace" };
			const currentHash = await options.currentContentHash(action);
			if (currentHash !== action.resource.contentHash) return { kind: "rejected", code: "stale-resource" };
			await options.openEditor(action);
			return { kind: "opened", action };
		},
	};
}
