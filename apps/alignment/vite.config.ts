import { homedir } from "node:os";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { readSessionEvents } from "./src/ingest/session-jsonl-source.js";
import { scanConversations } from "./src/server/conversations-api.js";
import { createPiHttpRoutes } from "./src/pi/http-routes.js";
import { createPiSessionRegistry } from "./src/pi/session-registry.js";

const MAX_EVENTS_PER_CONVERSATION = 5_000;
const SESSIONS_ROOT = join(homedir(), ".local/share/alef/sessions");
const FIXTURE_PATH = resolve(__dirname, "test/fixtures/session-sample.jsonl");
const FIXTURE_MODE = process.env.ALIGNMENT_FIXTURE_MODE === "1";

interface ResolvedConversation {
	id: string;
	name?: string;
	latestSessionId: string;
	lastActiveAt: string;
	totalTurns: number;
	totalErrors: number;
	filePath: string;
}

function fixtureConversations(): ResolvedConversation[] {
	return [
		{
			id: "fixture",
			name: "Fixture conversation",
			latestSessionId: "fixture-session",
			lastActiveAt: new Date().toISOString(),
			totalTurns: 2,
			totalErrors: 0,
			filePath: FIXTURE_PATH,
		},
		{
			id: "fixture-secondary",
			name: "Secondary fixture conversation",
			latestSessionId: "fixture-session-secondary",
			lastActiveAt: new Date(Date.now() - 60_000).toISOString(),
			totalTurns: 2,
			totalErrors: 0,
			filePath: FIXTURE_PATH,
		},
	];
}

function publicSummary(conversation: ResolvedConversation) {
	return {
		id: conversation.id,
		name: conversation.name,
		latestSessionId: conversation.latestSessionId,
		lastActiveAt: conversation.lastActiveAt,
		totalTurns: conversation.totalTurns,
		totalErrors: conversation.totalErrors,
	};
}

function writeJson(res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(body));
}

/**
 * Live Pi RPC sessions (real `pi --mode rpc` child processes), one per Chat
 * surface that has sent a message. Module-level so the registry survives
 * across requests within one dev-server process; disposeAll() on the Vite
 * dev server's own "close" hook ensures a restart or Ctrl+C never leaves an
 * orphaned `pi` process behind.
 */
function piApiPlugin(): Plugin {
	const registry = createPiSessionRegistry();
	const routes = createPiHttpRoutes(registry);

	return {
		name: "alignment-pi-api",
		configureServer(server) {
			server.middlewares.use("/api/pi/sessions", (req, res) => {
				if (req.method !== "POST") {
					res.statusCode = 405;
					res.end();
					return;
				}
				void routes.createSession(req, res);
			});
			server.middlewares.use("/api/pi/prompt", (req, res) => {
				void routes.sendPrompt(req, res);
			});
			server.middlewares.use("/api/pi/abort", (req, res) => {
				routes.abort(req, res);
			});
			server.middlewares.use("/api/pi/events", (req, res) => {
				routes.streamEvents(req, res);
			});
			server.httpServer?.once("close", () => registry.disposeAll());
		},
	};
}

function alignmentApiPlugin(): Plugin {
	let resolvedConversations = new Map<string, ResolvedConversation>();

	async function refreshConversations(): Promise<ResolvedConversation[]> {
		const conversations: ResolvedConversation[] = FIXTURE_MODE
			? fixtureConversations()
			: (await scanConversations(SESSIONS_ROOT)).map((conversation) => ({
					id: conversation.id,
					name: conversation.name,
					latestSessionId: conversation.latestSessionId,
					lastActiveAt: conversation.lastActiveAt,
					totalTurns: conversation.totalTurns,
					totalErrors: conversation.totalErrors,
					filePath: conversation.latestFilePath,
				}));
		resolvedConversations = new Map(conversations.map((conversation) => [conversation.id, conversation]));
		return conversations;
	}

	return {
		name: "alignment-local-api",
		configureServer(server) {
			server.middlewares.use("/api/conversations", (_req, res) => {
				refreshConversations()
					.then((conversations) => writeJson(res, 200, { conversations: conversations.map(publicSummary) }))
					.catch(() => writeJson(res, 500, { code: "conversation-list-failed", message: "Could not load local Alef conversations." }));
			});

			server.middlewares.use("/api/events", (req, res) => {
				const url = new URL(req.url ?? "", "http://alignment.local");
				const conversationId = url.searchParams.get("conversationId");
				if (!conversationId) {
					writeJson(res, 400, { code: "conversation-id-required", message: "A conversation id is required." });
					return;
				}

				const load = async () => {
					let conversation = resolvedConversations.get(conversationId);
					if (!conversation) conversation = (await refreshConversations()).find((candidate) => candidate.id === conversationId);
					if (!conversation) {
						writeJson(res, 404, { code: "conversation-not-found", message: "Conversation not found." });
						return;
					}
					const events = await readSessionEvents({
						filePath: conversation.filePath,
						sessionId: conversation.latestSessionId,
						maxEvents: MAX_EVENTS_PER_CONVERSATION,
					});
					writeJson(res, 200, { conversationId, sessionId: conversation.latestSessionId, events });
				};
				load().catch(() => writeJson(res, 500, { code: "conversation-events-failed", message: "Could not load conversation events." }));
			});
		},
	};
}

export default defineConfig({
	plugins: [react(), tailwindcss(), alignmentApiPlugin(), piApiPlugin()],
	build: {
		rollupOptions: {
			input: { alignment: resolve(__dirname, "index.html") },
		},
	},
	test: {
		exclude: ["**/node_modules/**", "**/e2e/**"],
		setupFiles: ["./src/test-setup.ts"],
	},
});
