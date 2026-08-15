import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentSessionRegistry } from "../agent/agent-session-registry.js";

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

/**
 * The agent-session half of zodiacd's API (per the "zodiacd API surface"
 * Papyrus Doc): request/reply for session lifecycle and turns, one SSE
 * broadcast channel per session that replays its own accumulated history to
 * a newly-attaching subscriber before switching to live tail -- the exact
 * mechanism a second client (or a reconnecting one) needs to see the same
 * conversation another client already started, which is the actual point
 * of zodiacd existing.
 */
export function createAgentRoutes(registry: AgentSessionRegistry) {
	return {
		async createSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
			// cwd is the only option a client can request today, and it's optional --
			// an empty body or a malformed one both fall back to the registry's own
			// default (the daemon's own cwd) rather than failing the request, the
			// same permissive fallback apps/web's own (now-superseded) session
			// creation route already established.
			let cwd: string | undefined;
			try {
				const body = await readJsonBody(req);
				const requestedCwd = (body as { cwd?: unknown } | undefined)?.cwd;
				if (typeof requestedCwd === "string" && requestedCwd.trim()) cwd = requestedCwd;
			} catch {
				// Malformed JSON body -- ignored, same fallback as no body at all.
			}
			try {
				const sessionId = await registry.create(cwd);
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
			for (const event of registry.history(sessionId)) {
				res.write(`data: ${JSON.stringify(event)}\n\n`);
			}
			const unsubscribeEvent = integration.onEvent((event) => {
				res.write(`data: ${JSON.stringify(event)}\n\n`);
			});
			const unsubscribeExit = integration.onExit((reason) => {
				res.write(`data: ${JSON.stringify({ type: "session-exited", reason })}\n\n`);
				res.end();
			});
			req.on("close", () => {
				unsubscribeEvent();
				unsubscribeExit();
			});
		},
	};
}
