import type { IncomingMessage, ServerResponse } from "node:http";
import type { PiSessionRegistry } from "./session-registry.js";

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

function sessionIdFrom(req: IncomingMessage): string | undefined {
	const queryIndex = (req.url ?? "").indexOf("?");
	if (queryIndex === -1) return undefined;
	return new URLSearchParams(req.url!.slice(queryIndex + 1)).get("sessionId") ?? undefined;
}

/** Real production-quality Node HTTP handlers for driving a live Pi RPC session -- registered as Vite dev-server middleware in vite.config.ts, exercised directly here without needing a Vite server. */
export function createPiHttpRoutes(registry: PiSessionRegistry) {
	return {
		async createSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
			// cwd is the only option a client can request today, and it's optional
			// -- an empty body (the common case, unchanged from before this
			// option existed) or a malformed one both fall back to the registry's
			// own default rather than failing the request, since nothing here is
			// required for a session to start.
			let cwd: string | undefined;
			try {
				const body = await readJsonBody(req);
				const requestedCwd = (body as { cwd?: unknown } | undefined)?.cwd;
				if (typeof requestedCwd === "string" && requestedCwd.trim()) cwd = requestedCwd;
			} catch {
				// Malformed JSON body -- ignored, same fallback as no body at all.
			}
			const sessionId = registry.create(cwd ? { cwd } : undefined);
			writeJson(res, 200, { sessionId });
		},

		async sendPrompt(req: IncomingMessage, res: ServerResponse): Promise<void> {
			const sessionId = sessionIdFrom(req);
			if (!sessionId) {
				writeJson(res, 400, { code: "session-id-required", message: "A sessionId is required." });
				return;
			}
			const session = registry.get(sessionId);
			if (!session) {
				writeJson(res, 404, { code: "session-not-found", message: "Pi session not found." });
				return;
			}
			let body: unknown;
			try {
				body = await readJsonBody(req);
			} catch {
				writeJson(res, 400, { code: "invalid-json", message: "Request body was not valid JSON." });
				return;
			}
			const message = (body as { message?: unknown } | undefined)?.message;
			if (typeof message !== "string" || !message.trim()) {
				writeJson(res, 400, { code: "message-required", message: "A non-empty message is required." });
				return;
			}
			session.sendPrompt(message);
			writeJson(res, 200, { accepted: true });
		},

		abort(req: IncomingMessage, res: ServerResponse): void {
			const sessionId = sessionIdFrom(req);
			const session = sessionId ? registry.get(sessionId) : undefined;
			if (!session) {
				writeJson(res, 404, { code: "session-not-found", message: "Pi session not found." });
				return;
			}
			session.abort();
			writeJson(res, 200, { accepted: true });
		},

		streamEvents(req: IncomingMessage, res: ServerResponse): void {
			const sessionId = sessionIdFrom(req);
			const session = sessionId ? registry.get(sessionId) : undefined;
			if (!session) {
				writeJson(res, 404, { code: "session-not-found", message: "Pi session not found." });
				return;
			}
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-store",
				Connection: "keep-alive",
			});
			// Node buffers headers until the first body write unless flushed
			// explicitly -- without this, a client (EventSource, or this route's own
			// test) sees no response at all until the first real event happens to
			// fire, instead of a live SSE connection immediately.
			res.flushHeaders();
			const unsubscribeEvent = session.onEvent((event) => {
				res.write(`data: ${JSON.stringify(event)}\n\n`);
			});
			const unsubscribeExit = session.onExit((code) => {
				res.write(`data: ${JSON.stringify({ type: "session-exited", code })}\n\n`);
				res.end();
			});
			req.on("close", () => {
				unsubscribeEvent();
				unsubscribeExit();
			});
		},
	};
}
