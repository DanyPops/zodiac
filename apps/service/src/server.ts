import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import type { AgentIntegrationPort } from "@zodiac/agent";
import type { WorldStore } from "@zodiac/server/world";
import type { ContributionCommand, ContributionDescription, ContributionResourceProvider, WorkspaceId } from "@zodiac/protocol";
import { createEventBus, type EventBus } from "@zodiac/server";
import type { PendingClientActions } from "@zodiac/server/agent";
import type { VehicleSurfaceGateway } from "@zodiac/server/vehicle";
import { createApprovalCenter, type ApprovalCenter } from "@zodiac/server/approval";
import { createAgentSessionRegistry } from "./agent/agent-session-registry.js";
import { fixtureReadSessionEvents, fixtureScanConversations } from "./fixtures/fixture-conversations.js";
import { createAgentRoutes } from "./routes/agent-routes.js";
import { createWorldRoutes } from "./routes/world-routes.js";
import { createConversationsRoutes } from "./routes/conversations-routes.js";
import { createContributionRoutes } from "./routes/contribution-routes.js";
import { createNotificationRoutes } from "./routes/notification-routes.js";
import { createTerminalRoutes } from "./routes/terminal-routes.js";
import { createToolGrantRoutes } from "./routes/tool-grant-routes.js";
import { createVehicleSurfaceRoutes } from "./routes/vehicle-surface-routes.js";
import { createTerminalSessionRegistry } from "./terminal/terminal-session-registry.js";
import type { TerminalPtyFactory } from "./terminal/terminal-pty-port.js";
import { createOriginPolicy } from "./security/origin-policy.js";

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
	/** Real EventBus backing /api/notifications' SSE stream -- defaults to a fresh in-process instance. Inject a shared one (as cli.ts does) so anything else that publishes onto "notification" elsewhere in the process (e.g. a future gated Integration invoke) is visible on the same stream a client actually connects to. */
	bus?: EventBus;
	/** Shared with whatever constructed this session's own tools (e.g. list_visual_cues' RemoteBrowserVisualCueClient) -- resolves a Client's own POST-back against the exact same registrations that adapter's calls are pending on. Omitted disables the client-actions route entirely (postClientAction always 404s). */
	pendingClientActions?: PendingClientActions;
	/** Real ApprovalCenter wired to `bus` -- defaults to a fresh instance over the given/default bus. Inject a shared one so approve()/deny() here agree with whatever originally called request() elsewhere. */
	approvalCenter?: ApprovalCenter;
	/** Optional server-side Vehicle proxy. Bearer tokens remain behind this port and never enter browser-visible responses. */
	vehicleSurfaces?: VehicleSurfaceGateway;
	/** Explicitly loaded package contributions exposed through bounded same-origin routes. */
	contributions?: {
		descriptions: readonly ContributionDescription[];
		commands: ReadonlyMap<string, ContributionCommand>;
		providers: ReadonlyMap<string, ContributionResourceProvider>;
	};
	/**
	 * Exact browser Origin values this daemon answers, e.g.
	 * ["http://127.0.0.1:5173"] for apps/web's own fixed dev port. Defaults
	 * to empty -- a request or WebSocket upgrade that carries an Origin
	 * header at all is refused outright unless it matches exactly. A
	 * request/upgrade with no Origin header (every real non-browser client)
	 * is unaffected; see origin-policy.ts's own doc comment for why that
	 * split is the real signal, not a loophole. cli.ts supplies the real
	 * default (parse-args.ts's own --allowed-origin/ZODIAC_ALLOWED_ORIGINS);
	 * an empty default here keeps this constructor's own behavior legible in
	 * isolation rather than silently baking in one caller's dev convention.
	 */
	allowedOrigins?: readonly string[];
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
	const bus = options.bus ?? createEventBus();
	const approvalCenter = options.approvalCenter ?? createApprovalCenter({ bus });
	const notificationRoutes = createNotificationRoutes(bus, approvalCenter);
	const worldRoutes = createWorldRoutes(options.world);
	const conversationsRoutes = createConversationsRoutes(
		options.fixtureMode ? { sessionsRoot: options.sessionsRoot, scan: fixtureScanConversations, readEvents: fixtureReadSessionEvents } : { sessionsRoot: options.sessionsRoot },
	);
	const agentSessionRegistry = createAgentSessionRegistry(options.createAgentIntegration);
	const agentRoutes = createAgentRoutes(agentSessionRegistry, options.getWorkspaceToolIds, options.pendingClientActions);

	// Only constructed when explicitly opted into -- see enableTerminal's own
	// doc comment on why this isn't wired by default.
	const terminalSessionRegistry = options.enableTerminal && options.createTerminalPty ? createTerminalSessionRegistry(options.createTerminalPty) : undefined;
	const terminalRoutes = terminalSessionRegistry ? createTerminalRoutes(terminalSessionRegistry) : undefined;
	const webSocketServer = terminalRoutes ? new WebSocketServer({ noServer: true }) : undefined;
	const toolGrantRoutes = options.getWorkspaceToolIds ? createToolGrantRoutes(options.getWorkspaceToolIds) : undefined;
	const vehicleSurfaceRoutes = options.vehicleSurfaces ? createVehicleSurfaceRoutes(options.vehicleSurfaces) : undefined;
	const contributionRoutes = options.contributions ? createContributionRoutes(options.contributions) : undefined;
	const originPolicy = createOriginPolicy(options.allowedOrigins ?? []);

	const server = createServer((req, res) => {
		// Default-deny, not reflected: an Origin header present but not on the
		// explicit allowlist is refused before any route runs -- CORS headers
		// alone never stopped the request body from executing server-side, only
		// whether a browser page's own script could read the response (see
		// origin-policy.ts's own doc comment). A request with no Origin header
		// at all (every real non-browser client) is unaffected.
		const origin = req.headers.origin;
		if (origin !== undefined && !originPolicy.isAllowed(origin)) {
			res.statusCode = 403;
			res.setHeader("Content-Type", "application/json");
			res.end(JSON.stringify({ code: "origin-not-allowed", message: "This origin is not permitted to call zodiacd." }));
			return;
		}
		// Vary: Origin -- this response's own CORS header depends on the
		// request's Origin, so an intermediary must not serve a cached response
		// for one allowed origin back to a different one.
		if (origin !== undefined) {
			res.setHeader("Access-Control-Allow-Origin", origin);
			res.setHeader("Vary", "Origin");
		}
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
		if (pathname.includes("/client-actions/") && pathname.startsWith("/api/agent/sessions/") && req.method === "POST") {
			void agentRoutes.postClientAction(req, res);
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
		if (contributionRoutes && pathname === "/api/contributions" && req.method === "GET") {
			contributionRoutes.list(req, res);
			return;
		}
		const contributionMatch = contributionRoutes ? /^\/api\/contributions\/([^/]+)\/(invoke|read)$/.exec(pathname) : null;
		if (contributionRoutes && contributionMatch) {
			const contributionId = decodeURIComponent(contributionMatch[1] ?? "");
			const action = contributionMatch[2];
			if (action === "invoke" && req.method === "POST") void contributionRoutes.invoke(req, res, contributionId);
			else if (action === "read" && req.method === "POST") void contributionRoutes.read(req, res, contributionId);
			else { res.statusCode = 405; res.end(); }
			return;
		}
		if (vehicleSurfaceRoutes && pathname === "/api/vehicle-surfaces" && req.method === "GET") {
			vehicleSurfaceRoutes.list(req, res);
			return;
		}
		const vehicleSurfaceMatch = vehicleSurfaceRoutes ? /^\/api\/vehicle-surfaces\/([^/]+)\/(manifest|invoke|events)$/.exec(pathname) : null;
		if (vehicleSurfaceRoutes && vehicleSurfaceMatch) {
			const surfaceId = decodeURIComponent(vehicleSurfaceMatch[1] ?? "");
			const action = vehicleSurfaceMatch[2];
			if (action === "manifest" && req.method === "GET") void vehicleSurfaceRoutes.manifest(req, res, surfaceId);
			else if (action === "invoke" && req.method === "POST") void vehicleSurfaceRoutes.invoke(req, res, surfaceId);
			else if (action === "events" && req.method === "GET") void vehicleSurfaceRoutes.events(req, res, surfaceId);
			else {
				res.statusCode = 405;
				res.end();
			}
			return;
		}
		if (pathname === "/api/notifications" && req.method === "GET") {
			notificationRoutes.streamNotifications(req, res);
			return;
		}
		const notificationDecisionMatch = req.method === "POST" ? /^\/api\/notifications\/([^/]+)\/(approve|deny)$/.exec(pathname) : null;
		if (notificationDecisionMatch) {
			const [, requestId, action] = notificationDecisionMatch;
			if (action === "approve") notificationRoutes.postApprove(req, res, requestId ?? "");
			else notificationRoutes.postDeny(req, res, requestId ?? "");
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
		// Same default-deny origin check as the plain HTTP handler above --
		// forged Origin/no-check upgrade is exactly how a browser page could
		// otherwise attach to a live terminal WebSocket cross-origin.
		const upgradeOrigin = req.headers.origin;
		if (upgradeOrigin !== undefined && !originPolicy.isAllowed(upgradeOrigin)) {
			socket.destroy();
			return;
		}
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
