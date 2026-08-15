import { createServer, type Server } from "node:http";
import type { AgentIntegrationPort } from "@zodiac/agent";
import type { WorldStore } from "@zodiac/server/world";
import { createAgentSessionRegistry } from "./agent/agent-session-registry.js";
import { createAgentRoutes } from "./routes/agent-routes.js";
import { createWorldRoutes } from "./routes/world-routes.js";
import { createConversationsRoutes } from "./routes/conversations-routes.js";

export interface CreateZodiacServiceOptions {
	world: WorldStore;
	/** Root of Alef's local session store, e.g. ~/.local/share/alef/sessions. */
	sessionsRoot: string;
	/** 0 binds an ephemeral port -- what every test here uses. */
	port: number;
	host: string;
	/** Constructs a fresh AgentIntegrationPort per new agent session, given an optional client-requested cwd -- a real createZodiacAgentSession(...).integration in production, a fake port in tests. */
	createAgentIntegration: (cwd?: string) => AgentIntegrationPort | Promise<AgentIntegrationPort>;
}

export interface ZodiacService {
	readonly server: Server;
	readonly baseUrl: string;
	close: () => Promise<void>;
}

/**
 * Wires the World, Conversations, and Agent-session route groups (see the
 * "zodiacd API surface" Papyrus Doc) into one standalone Node HTTP server --
 * no framework, mirroring apps/web's own pi/http-routes.ts, which the World
 * and Conversations routes were themselves promoted alongside.
 */
export function createZodiacService(options: CreateZodiacServiceOptions): Promise<ZodiacService> {
	const worldRoutes = createWorldRoutes(options.world);
	const conversationsRoutes = createConversationsRoutes({ sessionsRoot: options.sessionsRoot });
	const agentSessionRegistry = createAgentSessionRegistry(options.createAgentIntegration);
	const agentRoutes = createAgentRoutes(agentSessionRegistry);

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
		if (pathname === "/api/agent/sessions" && req.method === "POST") {
			void agentRoutes.createSession(req, res);
			return;
		}
		if (pathname === "/api/agent/sessions" && req.method === "GET") {
			agentRoutes.listSessions(req, res);
			return;
		}
		if (pathname.endsWith("/events") && pathname.startsWith("/api/agent/sessions/") && req.method === "GET") {
			agentRoutes.streamEvents(req, res);
			return;
		}
		if (pathname.startsWith("/api/agent/sessions/") && req.method === "POST") {
			void agentRoutes.dispatchAction(req, res);
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
				close: () =>
					new Promise<void>((res2, rej2) => {
						agentSessionRegistry.disposeAll();
						server.close((err) => (err ? rej2(err) : res2()));
					}),
			});
		});
	});
}
