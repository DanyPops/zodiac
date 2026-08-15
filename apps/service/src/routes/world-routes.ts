import type { IncomingMessage, ServerResponse } from "node:http";
import { CommandIntentSchema, parseWithSchema } from "@zodiac/protocol";
import type { WorldStore } from "@zodiac/server/world";

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
export function createWorldRoutes(world: WorldStore) {
	return {
		getWorld(_req: IncomingMessage, res: ServerResponse): void {
			writeJson(res, 200, world.worldViewModel());
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
			try {
				world.apply(parsed.value);
			} catch (error) {
				writeJson(res, 400, { code: "command-failed", message: error instanceof Error ? error.message : String(error) });
				return;
			}
			writeJson(res, 200, { accepted: true });
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
			res.write(`data: ${JSON.stringify(world.worldViewModel())}\n\n`);
			const unsubscribe = world.onChange((viewModel) => {
				res.write(`data: ${JSON.stringify(viewModel)}\n\n`);
			});
			req.on("close", () => unsubscribe());
		},
	};
}
