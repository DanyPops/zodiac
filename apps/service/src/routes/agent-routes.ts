import type { IncomingMessage, ServerResponse } from "node:http";
import type { WorkspaceId } from "@zodiac/protocol";
import type { PendingClientActions } from "@zodiac/server/agent";
import type { AgentSessionRegistry } from "../agent/agent-session-registry.js";
import { writeSseFrame } from "./sse-writer.js";

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let raw = "";
		req.on("data", (chunk: Buffer) => {
			raw += chunk.toString("utf8");
		});
		req.on("end", () => {
			if (!raw.trim()) {
				resolve(undefined);
				return;
			}
			try {
				resolve(JSON.parse(raw));
			} catch (error) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
		req.on("error", (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))));
	});
}

/** Matches /api/agent/sessions/:id/:action against a real pathname. */
const ACTION_PATTERN = /^\/api\/agent\/sessions\/([^/]+)\/([a-zA-Z]+)$/;

function matchAction(pathname: string): { sessionId: string; action: string } | undefined {
	const match = ACTION_PATTERN.exec(pathname);
	if (!match) return undefined;
	const [, sessionId, action] = match;
	if (!sessionId || !action) return undefined;
	return { sessionId, action };
}

/** Matches /api/agent/sessions/:id/client-actions/:toolCallId -- the Client's own POST-back half of the round trip a tool like list_visual_cues depends on (PendingClientActions.register()'s own counterpart). Deliberately a separate pattern from ACTION_PATTERN above (a hyphenated segment, a second path component) rather than folding it into that one, general-purpose action dispatcher. */
const CLIENT_ACTION_PATTERN = /^\/api\/agent\/sessions\/([^/]+)\/client-actions\/([^/]+)$/;

function matchClientAction(pathname: string): { sessionId: string; toolCallId: string } | undefined {
	const match = CLIENT_ACTION_PATTERN.exec(pathname);
	if (!match) return undefined;
	const [, sessionId, toolCallId] = match;
	if (!sessionId || !toolCallId) return undefined;
	return { sessionId, toolCallId: decodeURIComponent(toolCallId) };
}

/**
 * The agent-session half of zodiacd's API (per the "zodiacd API surface"
 * Papyrus Doc): request/reply for session lifecycle and turns, one SSE
 * broadcast channel per session that replays its own accumulated history to
 * a newly-attaching subscriber before switching to live tail -- the exact
 * mechanism a second client (or a reconnecting one) needs to see the same
 * conversation another client already started, which is the actual point
 * of zodiacd existing.
 */
export function createAgentRoutes(
	registry: AgentSessionRegistry,
	getWorkspaceToolIds?: (workspaceId: WorkspaceId) => readonly string[],
	pendingClientActions?: PendingClientActions,
	options?: { maxSseBufferedBytes?: number; workspaceExists?: (workspaceId: WorkspaceId) => boolean },
) {
	const maxSseBufferedBytes = options?.maxSseBufferedBytes;
	return {
		/**
		 * The Client's own POST-back half of the round trip a tool like
		 * list_visual_cues depends on: the Client observed a real tool-call-start
		 * SSE event naming this exact toolCallId (see streamEvents below -- the
		 * same channel, no new one), ran the real action itself, and reports the
		 * result here on its own initiative -- the same direction every other
		 * Client-originated call in this codebase already goes, never a daemon
		 * broadcast-and-race. Always 200s (even a stale/duplicate/late post,
		 * which resolve() itself already treats as a real, expected no-op) -- the
		 * one real failure mode (nothing was ever pending) isn't the posting
		 * Client's own fault to report as an error.
		 */
		async postClientAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
			const url = new URL(req.url ?? "", "http://zodiac.local");
			const matched = matchClientAction(url.pathname);
			if (!matched || !pendingClientActions) {
				writeJson(res, 404, { code: "not-found", message: "No matching client-action route." });
				return;
			}
			let body: unknown;
			try {
				body = await readJsonBody(req);
			} catch {
				writeJson(res, 400, { code: "invalid-json", message: "Request body was not valid JSON." });
				return;
			}
			const delivered = pendingClientActions.resolve(matched.toolCallId, (body as { result?: unknown } | undefined)?.result);
			writeJson(res, 200, { delivered });
		},

		async createSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
			// Malformed/empty body falls back to defaults (registry's own cwd, no tool grant) rather than failing the request.
			let cwd: string | undefined;
			let initialActiveToolNames: readonly string[] | undefined;
			let workspaceId: WorkspaceId | undefined;
			try {
				const body = await readJsonBody(req);
				const requestedCwd = (body as { cwd?: unknown } | undefined)?.cwd;
				if (typeof requestedCwd === "string" && requestedCwd.trim()) cwd = requestedCwd;
				// Never trust a client-supplied tool list -- only a workspaceId, resolved server-side against the real WorldStore-derived grant.
				const requestedWorkspaceId = (body as { workspaceId?: unknown } | undefined)?.workspaceId;
				if (typeof requestedWorkspaceId === "string" && requestedWorkspaceId.trim()) {
					const candidate = requestedWorkspaceId as WorkspaceId;
					if (!options?.workspaceExists?.(candidate)) {
						writeJson(res, 404, { code: "workspace-not-found", message: "Workspace is unavailable." });
						return;
					}
					workspaceId = candidate;
					if (getWorkspaceToolIds) initialActiveToolNames = getWorkspaceToolIds(workspaceId);
				}
			} catch {
				// Malformed JSON body -- ignored, same fallback as no body at all.
			}
			try {
				const sessionId = await registry.create(cwd, initialActiveToolNames, workspaceId);
				writeJson(res, 200, { sessionId });
			} catch (error) {
				// A real construction failure (no model configured, no network for
				// ModelRuntime.create, ...) must become a clean 500, not an unhandled
				// rejection that crashes the daemon process for every other live
				// session it's already hosting.
				writeJson(res, 500, { code: "session-create-failed", message: error instanceof Error ? error.message : String(error) });
			}
		},

		listSessions(_req: IncomingMessage, res: ServerResponse): void {
			writeJson(res, 200, { sessions: registry.list() });
		},

		async dispatchAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
			const url = new URL(req.url ?? "", "http://zodiac.local");
			const matched = matchAction(url.pathname);
			if (!matched) {
				writeJson(res, 404, { code: "not-found", message: "No matching agent-session route." });
				return;
			}
			const { sessionId, action } = matched;
			const integration = registry.get(sessionId);
			if (!integration) {
				writeJson(res, 404, { code: "session-not-found", message: "Agent session not found." });
				return;
			}

			if (action === "abort") {
				await integration.abort();
				writeJson(res, 200, { accepted: true });
				return;
			}

			const sessionControl = integration.session;
			if (action === "setModel" || action === "compact" || action === "resume" || action === "fork") {
				if (!sessionControl) {
					writeJson(res, 200, { ok: false, reason: "unsupported", message: "This agent adapter does not expose session controls." });
					return;
				}
				let body: unknown;
				try {
					body = await readJsonBody(req);
				} catch {
					writeJson(res, 400, { code: "invalid-json", message: "Request body was not valid JSON." });
					return;
				}
				const value = body as Record<string, unknown> | undefined;
				if (action === "setModel") {
					if (typeof value?.provider !== "string" || typeof value.modelId !== "string") {
						writeJson(res, 400, { code: "model-required", message: "provider and modelId are required." });
						return;
					}
					writeJson(res, 200, await sessionControl.setModel(value.provider, value.modelId));
					return;
				}
				if (action === "compact") {
					if (value?.customInstructions !== undefined && typeof value.customInstructions !== "string") {
						writeJson(res, 400, { code: "invalid-instructions", message: "customInstructions must be a string." });
						return;
					}
					writeJson(res, 200, await sessionControl.compact(value?.customInstructions as string | undefined));
					return;
				}
				const field = action === "resume" ? "sessionPath" : "entryId";
				const target = value?.[field];
				if (typeof target !== "string" || !target.trim()) {
					writeJson(res, 400, { code: "target-required", message: `${field} is required.` });
					return;
				}
				writeJson(res, 200, action === "resume" ? await sessionControl.resume(target) : await sessionControl.fork(target));
				return;
			}

			if (action !== "prompt" && action !== "steer" && action !== "followUp") {
				writeJson(res, 404, { code: "not-found", message: `Unknown agent-session action "${action}".` });
				return;
			}

			let body: unknown;
			try {
				body = await readJsonBody(req);
			} catch {
				writeJson(res, 400, { code: "invalid-json", message: "Request body was not valid JSON." });
				return;
			}
			const text = (body as { text?: unknown } | undefined)?.text;
			if (typeof text !== "string" || !text.trim()) {
				writeJson(res, 400, { code: "text-required", message: "A non-empty text is required." });
				return;
			}
			await integration[action](text);
			writeJson(res, 200, { accepted: true });
		},

		streamEvents(req: IncomingMessage, res: ServerResponse): void {
			const url = new URL(req.url ?? "", "http://zodiac.local");
			const match = /^\/api\/agent\/sessions\/([^/]+)\/events$/.exec(url.pathname);
			const sessionId = match?.[1];
			const integration = sessionId ? registry.get(sessionId) : undefined;
			if (!sessionId || !integration) {
				writeJson(res, 404, { code: "session-not-found", message: "Agent session not found." });
				return;
			}

			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-store",
				Connection: "keep-alive",
			});
			res.flushHeaders();
			// Replay-then-tail: a newly-attaching subscriber must see the whole
			// conversation so far, not just events from this instant forward --
			// the same requirement Alef's own RemoteSession solves via a separate
			// /history fetch before its /events SSE connects (see the "prior art
			// from ~/Workspace/alef" Papyrus Doc); here it's one channel instead.
			//
			// A slow/non-reading client replaying up to MAX_HISTORY_EVENTS (5,000) events in
			// one tight synchronous loop is exactly the kind of burst sse-writer.ts's own
			// buffered-bytes cap (not Node's small default highWaterMark) is sized to absorb --
			// but a genuinely stuck client still must not accumulate history forever, hence the
			// break the moment a frame reports the connection is already gone.
			for (const event of registry.history(sessionId)) {
				if (!writeSseFrame(res, event, maxSseBufferedBytes)) return;
			}
			const unsubscribeEvent = integration.onEvent((event) => {
				// See sse-writer.ts's own doc comment (grounded in opencode's real 187GB RSS
				// incident) -- a per-connection close on a slow client, never daemon-wide.
				if (!writeSseFrame(res, event, maxSseBufferedBytes)) {
					unsubscribeEvent();
					unsubscribeExit();
				}
			});
			const unsubscribeExit = integration.onExit((reason) => {
				if (!writeSseFrame(res, { type: "session-exited", reason }, maxSseBufferedBytes)) return;
				res.end();
			});
			req.on("close", () => {
				unsubscribeEvent();
				unsubscribeExit();
			});
		},
	};
}
