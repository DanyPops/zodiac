import type { IncomingMessage, ServerResponse } from "node:http";
import { CommandIntentSchema, parseWithSchema } from "@zodiac/protocol";
import type { WorldStore } from "@zodiac/server/world";
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

/**
 * The World half of zodiacd's API (per the "zodiacd API surface" Papyrus
 * Doc): GET for the current snapshot, POST to dispatch a typed CommandIntent
 * (already Zod-validated, already exhaustively handled by WorldStore.apply --
 * this route is a thin transport wrapper, not new domain logic), and an SSE
 * broadcast channel every attached client subscribes to via WorldStore's
 * own onChange hook.
 */
export function createWorldRoutes(world: WorldStore, options?: { maxSseBufferedBytes?: number }) {
	const maxSseBufferedBytes = options?.maxSseBufferedBytes;
	return {
		getWorld(_req: IncomingMessage, res: ServerResponse): void {
			writeJson(res, 200, world.worldViewModel());
		},

		/** Global World chrome (Panel placement), separate from getWorld since Panels aren't Workspace-scoped -- see WorldStore.panels' own doc comment. */
		getPanels(_req: IncomingMessage, res: ServerResponse): void {
			writeJson(res, 200, { panels: world.panels() });
		},

		async postCommand(req: IncomingMessage, res: ServerResponse): Promise<void> {
			let body: unknown;
			try {
				body = await readJsonBody(req);
			} catch {
				writeJson(res, 400, { code: "invalid-json", message: "Request body was not valid JSON." });
				return;
			}
			const intent = (body as { intent?: unknown } | undefined)?.intent;
			const parsed = parseWithSchema(CommandIntentSchema, intent);
			if (!parsed.ok) {
				writeJson(res, 400, { code: "invalid-intent", message: "Request body was not a recognized CommandIntent.", issues: parsed.issues });
				return;
			}
			let outcome: Awaited<ReturnType<WorldStore["apply"]>>;
			try {
				// world.apply() itself is synchronous for every CommandIntent variant
				// except integration.invoke, whose own registered handler may be async
				// (see IntegrationInvokeHandler's own doc comment) -- awaiting here is
				// correct and harmless for the synchronous cases too.
				outcome = await world.apply(parsed.value);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				// Every other 400 branch above is a caller-input problem (malformed JSON,
				// an unrecognized intent shape) that's self-explanatory from the response
				// alone. A thrown apply() error is different -- it means a *validated*
				// intent still failed against the World's own current state (an unknown
				// Workspace/Window/Surface id, most often), which is exactly the kind of
				// thing worth a server-side log trail for: the caller's own console only
				// sees a bare HTTP status without reading the response body itself.
				console.error(`[zodiacd] command rejected: ${parsed.value.type} -- ${message}`);
				writeJson(res, 400, { code: "command-failed", message });
				return;
			}
			// commandId/result round-trip the request/response correlation a
			// caller needs once more than one caller (a human and an agent, two
			// browser tabs) can be dispatching concurrently -- see WorldStore.apply's
			// own doc comment. Both are omitted entirely (not just undefined) when
			// there is nothing to report, rather than sending null noise. surfaceId
			// and invokeResult are mutually exclusive in practice (one per
			// CommandIntent variant), but both are spread into the same `result`
			// object rather than picking one, so a future variant that legitimately
			// produces both isn't blocked by this shape.
			const result = { ...(outcome.surfaceId !== undefined ? { surfaceId: outcome.surfaceId } : {}), ...(outcome.invokeResult !== undefined ? { invoke: outcome.invokeResult } : {}) };
			writeJson(res, 200, {
				accepted: true,
				...(outcome.commandId !== undefined ? { commandId: outcome.commandId } : {}),
				...(Object.keys(result).length > 0 ? { result } : {}),
			});
		},

		streamEvents(req: IncomingMessage, res: ServerResponse): void {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-store",
				Connection: "keep-alive",
			});
			// Flushed immediately (same reasoning as the Pi event routes): a
			// client must see a live connection before the first real change,
			// and gets the current snapshot as its own first frame here so a
			// late-joining client never has to guess whether it missed anything.
			res.flushHeaders();
			if (!writeSseFrame(res, { viewModel: world.worldViewModel() }, maxSseBufferedBytes)) return;
			const unsubscribe = world.onChange((change) => {
				// Falls behind on the World's own broadcast -- see sse-writer.ts's own doc comment
				// (grounded in opencode's real 187GB RSS incident). This is a per-connection close,
				// never a daemon-wide one -- every other attached client keeps receiving updates.
				if (!writeSseFrame(res, change, maxSseBufferedBytes)) unsubscribe();
			});
			req.on("close", () => unsubscribe());
		},
	};
}
