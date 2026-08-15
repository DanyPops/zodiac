import type { IncomingMessage, ServerResponse } from "node:http";
import type WebSocket from "ws";
import type { TerminalSessionRegistry } from "../terminal/terminal-session-registry.js";

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

export interface TerminalRoutes {
	createSession(req: IncomingMessage, res: ServerResponse): Promise<void>;
	listSessions(req: IncomingMessage, res: ServerResponse): void;
	/** Wired from server.ts's own "upgrade" handler, after wss.handleUpgrade has already produced a real, open WebSocket for /api/terminal/sessions/:id. */
	handleConnection(ws: WebSocket, sessionId: string): void;
}

/**
 * The terminal-session half of zodiacd's API (per the "zodiacd API surface"
 * Papyrus Doc's Terminal sessions section): request/reply to spawn a
 * persistent, detachable pty, one WebSocket per session carrying both
 * directions -- input/resize from the client, output/exit from the server
 * -- replaying buffered output on (re)attach before tailing live data,
 * mirroring VS Code's own RemoteTerminalChannelClient (onProcessReplay ->
 * onProcessData) rather than guessed.
 */
export function createTerminalRoutes(registry: TerminalSessionRegistry): TerminalRoutes {
	return {
		async createSession(req, res): Promise<void> {
			// cwd is the only option a client can request today, and it's optional
			// -- same permissive fallback agent-routes.ts's own createSession
			// already established.
			let cwd: string | undefined;
			try {
				const body = await readJsonBody(req);
				const requestedCwd = (body as { cwd?: unknown } | undefined)?.cwd;
				if (typeof requestedCwd === "string" && requestedCwd.trim()) cwd = requestedCwd;
			} catch {
				// Malformed JSON body -- ignored, same fallback as no body at all.
			}
			const sessionId = registry.create(cwd);
			writeJson(res, 200, { sessionId });
		},

		listSessions(_req, res): void {
			writeJson(res, 200, { sessions: registry.list() });
		},

		handleConnection(ws, sessionId): void {
			const port = registry.get(sessionId);
			if (!port) {
				ws.close(4404, "terminal session not found");
				return;
			}

			// Replay-then-tail: a newly-attaching (or reattaching) client must see
			// the whole scrollback so far, not just output from this instant
			// forward -- the same requirement agent-routes.ts's own streamEvents
			// already solves for agent sessions, here carried over one socket that
			// also does the client->server direction.
			const buffered = registry.history(sessionId);
			if (buffered) ws.send(JSON.stringify({ type: "output", data: buffered }));

			const unsubscribeData = port.onData((data) => {
				if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "output", data }));
			});
			// The shell exiting on its own is reported to every attached client,
			// but never closes their socket for them -- a client decides for
			// itself when it's done watching a session that just ended.
			const unsubscribeExit = port.onExit((exitCode) => {
				if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "exit", exitCode }));
			});

			ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
				let message: unknown;
				try {
					message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
				} catch {
					return;
				}
				if (!message || typeof message !== "object") return;
				const type = (message as { type?: unknown }).type;
				if (type === "input") {
					const data = (message as { data?: unknown }).data;
					if (typeof data === "string") port.write(data);
				} else if (type === "resize") {
					const cols = (message as { cols?: unknown }).cols;
					const rows = (message as { rows?: unknown }).rows;
					if (typeof cols === "number" && typeof rows === "number") port.resize(cols, rows);
				}
			});

			// Disconnecting a client never kills the pty -- persistence/detachment
			// is the entire point (see the registry's own doc comment); only an
			// explicit close route or the shell exiting on its own removes a
			// session.
			ws.on("close", () => {
				unsubscribeData();
				unsubscribeExit();
			});
		},
	};
}
