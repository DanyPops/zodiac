import { createServer, type Server } from "node:http";
import type { WorldStore } from "@zodiac/server/world";
import { createWorldRoutes } from "./routes/world-routes.js";
import { createConversationsRoutes } from "./routes/conversations-routes.js";

export interface CreateZodiacServiceOptions {
	world: WorldStore;
	/** Root of Alef's local session store, e.g. ~/.local/share/alef/sessions. */
	sessionsRoot: string;
	/** 0 binds an ephemeral port -- what every test here uses. */
	port: number;
	host: string;
}

export interface ZodiacService {
	readonly server: Server;
	readonly baseUrl: string;
	close: () => Promise<void>;
}

/**
 * Wires the World and Conversations route groups (see the "zodiacd API
 * surface" Papyrus Doc) into one standalone Node HTTP server -- no
 * framework, mirroring apps/web's own pi/http-routes.ts, which this
 * package's routes were themselves promoted alongside. Agent-session
 * routes are a separate, later addition (zodiacd stage 3), not this file's
 * concern yet.
 */
export function createZodiacService(options: CreateZodiacServiceOptions): Promise<ZodiacService> {
	const worldRoutes = createWorldRoutes(options.world);
	const conversationsRoutes = createConversationsRoutes({ sessionsRoot: options.sessionsRoot });

	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "", "http://zodiac.local");
		const { pathname } = url;

		if (pathname === "/healthz") {
			res.statusCode = 200;
			res.end("ok");
			return;
		}
		if (pathname === "/api/world" && req.method === "GET") {
			worldRoutes.getWorld(req, res);
			return;
		}
		if (pathname === "/api/world/commands" && req.method === "POST") {
			void worldRoutes.postCommand(req, res);
			return;
		}
		if (pathname === "/api/world/events" && req.method === "GET") {
			worldRoutes.streamEvents(req, res);
			return;
		}
		if (pathname === "/api/conversations" && req.method === "GET") {
			void conversationsRoutes.getConversations(req, res);
			return;
		}
		if (pathname === "/api/conversations/events" && req.method === "GET") {
			void conversationsRoutes.getConversationEvents(req, res);
			return;
		}

		res.statusCode = 404;
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ code: "not-found", message: `No route for ${req.method} ${pathname}` }));
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port, options.host, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				reject(new Error("zodiacd: expected a bound TCP address"));
				return;
			}
			resolve({
				server,
				baseUrl: `http://${options.host}:${address.port}`,
				close: () => new Promise<void>((res2, rej2) => server.close((err) => (err ? rej2(err) : res2()))),
			});
		});
	});
}
