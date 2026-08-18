import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import type { AgentIntegrationPort } from "@zodiac/agent";
import type { WorldStore } from "@zodiac/server/world";
import type { WorkspaceId } from "@zodiac/protocol";
import { createAgentSessionRegistry } from "./agent/agent-session-registry.js";
import { fixtureReadSessionEvents, fixtureScanConversations } from "./fixtures/fixture-conversations.js";
import { createAgentRoutes } from "./routes/agent-routes.js";
import { createWorldRoutes } from "./routes/world-routes.js";
import { createConversationsRoutes } from "./routes/conversations-routes.js";
import { createTerminalRoutes } from "./routes/terminal-routes.js";
import { createToolGrantRoutes } from "./routes/tool-grant-routes.js";
import { createTerminalSessionRegistry } from "./terminal/terminal-session-registry.js";
import type { TerminalPtyFactory } from "./terminal/terminal-pty-port.js";

export interface CreateZodiacServiceOptions {
	world: WorldStore;
	/** Root of Alef's local session store, e.g. ~/.local/share/alef/sessions. */
	sessionsRoot: string;
	/** 0 binds an ephemeral port -- what every test here uses. */
	port: number;
	host: string;
	/** Serve deterministic fixture conversations instead of scanning sessionsRoot -- see apps/service/src/fixtures. */
	fixtureMode?: boolean;
	/** Constructs a fresh AgentIntegrationPort per new agent session, given an optional client-requested cwd -- a real createZodiacAgentSession(...).integration in production, a fake port in tests. */
	createAgentIntegration: (cwd?: string, initialActiveToolNames?: readonly string[]) => AgentIntegrationPort | Promise<AgentIntegrationPort>;
	/** Wires the terminal-session routes (POST to spawn, WS to attach) -- off by default, see parse-args.ts's own doc comment on why. */
	enableTerminal?: boolean;
	/** Constructs a real pty per new terminal session -- a real node-pty child in production (createNodePtyFactory), a fake port in tests. Required when enableTerminal is true. */
	createTerminalPty?: TerminalPtyFactory;
	/** Read side of the live per-Workspace tool-grant reactor (@zodiac/server/agent) -- omitted disables the diagnostic tools route entirely. */
	getWorkspaceToolIds?: (workspaceId: WorkspaceId) => readonly string[];
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
	const conversationsRoutes = createConversationsRoutes(
		options.fixtureMode ? { sessionsRoot: options.sessionsRoot, scan: fixtureScanConversations, readEvents: fixtureReadSessionEvents } : { sessionsRoot: options.sessionsRoot },
	);
	const agentSessionRegistry = createAgentSessionRegistry(options.createAgentIntegration);
	const agentRoutes = createAgentRoutes(agentSessionRegistry, options.getWorkspaceToolIds);

	// Only constructed when explicitly opted into -- see enableTerminal's own
	// doc comment on why this isn't wired by default.
	const terminalSessionRegistry = options.enableTerminal && options.createTerminalPty ? createTerminalSessionRegistry(options.createTerminalPty) : undefined;
	const terminalRoutes = terminalSessionRegistry ? createTerminalRoutes(terminalSessionRegistry) : undefined;
	const webSocketServer = terminalRoutes ? new WebSocketServer({ noServer: true }) : undefined;
	const toolGrantRoutes = options.getWorkspaceToolIds ? createToolGrantRoutes(options.getWorkspaceToolIds) : undefined;

	const server = createServer((req, res) => {
		// A browser-served static build (dist/) is necessarily a different origin
		// than the daemon -- reflecting the request's own Origin (rather than a
		// blanket "*") keeps this working with credentials/cookies later without
		// another change here, and answering every OPTIONS preflight up front
		// means no individual route below has to know CORS exists at all.
		const origin = req.headers.origin;
		if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");
		if (req.method === "OPTIONS") {
			res.statusCode = 204;
			res.end();
			return;
		}

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
		if (pathname === "/api/world/panels" && req.method === "GET") {
			worldRoutes.getPanels(req, res);
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
		if (terminalRoutes && pathname === "/api/terminal/sessions" && req.method === "POST") {
			void terminalRoutes.createSession(req, res);
			return;
		}
		if (terminalRoutes && pathname === "/api/terminal/sessions" && req.method === "GET") {
			terminalRoutes.listSessions(req, res);
			return;
		}
		const toolsMatch = toolGrantRoutes && req.method === "GET" ? /^\/api\/world\/workspaces\/([^/]+)\/tools$/.exec(pathname) : null;
		if (toolGrantRoutes && toolsMatch) {
			toolGrantRoutes.getWorkspaceTools(toolsMatch[1] ?? "", res);
			return;
		}

		res.statusCode = 404;
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify({ code: "not-found", message: `No route for ${req.method} ${pathname}` }));
	});

	// A WebSocket upgrade is a separate Node http.Server event, never routed
	// through the request handler above -- terminalRoutes is only defined at
	// all when enableTerminal opted in, so a WS upgrade request against a
	// daemon that never enabled terminals is destroyed outright, the same
	// refusal posture the request handler's own 404 gives every other route.
	server.on("upgrade", (req, socket, head) => {
		const pathname = new URL(req.url ?? "", "http://zodiac.local").pathname;
		const match = terminalRoutes && webSocketServer ? /^\/api\/terminal\/sessions\/([^/]+)$/.exec(pathname) : null;
		const sessionId = match?.[1];
		if (!terminalRoutes || !webSocketServer || !sessionId) {
			socket.destroy();
			return;
		}
		webSocketServer.handleUpgrade(req, socket, head, (ws) => terminalRoutes.handleConnection(ws, sessionId));
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
						terminalSessionRegistry?.disposeAll();
						webSocketServer?.close();
						server.close((err) => (err ? rej2(err) : res2()));
					}),
			});
		});
	});
}
