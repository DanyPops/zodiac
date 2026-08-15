import type { IncomingMessage, ServerResponse } from "node:http";
import { readSessionEvents, scanConversations, type Conversation, type NormalizedEvent, type ReadSessionEventsOptions } from "@zodiac/server/conversations";

const MAX_EVENTS_PER_CONVERSATION = 5_000;

interface ResolvedConversation {
	id: string;
	name?: string;
	latestSessionId: string;
	lastActiveAt: string;
	totalTurns: number;
	totalErrors: number;
	filePath: string;
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

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(body));
}

export interface ConversationsRoutesOptions {
	/** Root of Alef's local session store, e.g. ~/.local/share/alef/sessions. */
	sessionsRoot: string;
	/** Overridable for tests/fixture-mode (see apps/service/src/fixtures) -- defaults to a real scanConversations(sessionsRoot) call. */
	scan?: (sessionsRoot: string) => Promise<Conversation[]>;
	/** Overridable for tests/fixture-mode -- defaults to the real readSessionEvents. */
	readEvents?: (options: ReadSessionEventsOptions) => Promise<NormalizedEvent[]>;
}

/**
 * The Conversations half of zodiacd's API -- promoted near-verbatim from
 * apps/web's own Vite dev-only zodiacApiPlugin (see the "Zodiac state
 * architecture" Papyrus Doc for why that plugin never worked outside
 * `vite dev`). Same behavior, now hosted by a real standalone process any
 * client can reach.
 */
export function createConversationsRoutes(options: ConversationsRoutesOptions) {
	const { sessionsRoot, scan = scanConversations, readEvents = readSessionEvents } = options;
	let resolvedConversations = new Map<string, ResolvedConversation>();

	async function refreshConversations(): Promise<ResolvedConversation[]> {
		const scanned: Conversation[] = await scan(sessionsRoot);
		const conversations: ResolvedConversation[] = scanned.map((conversation) => ({
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
		async getConversations(_req: IncomingMessage, res: ServerResponse): Promise<void> {
			try {
				const conversations = await refreshConversations();
				writeJson(res, 200, { conversations: conversations.map(publicSummary) });
			} catch {
				writeJson(res, 500, { code: "conversation-list-failed", message: "Could not load local Alef conversations." });
			}
		},

		async getConversationEvents(req: IncomingMessage, res: ServerResponse): Promise<void> {
			const url = new URL(req.url ?? "", "http://zodiac.local");
			const conversationId = url.searchParams.get("conversationId");
			if (!conversationId) {
				writeJson(res, 400, { code: "conversation-id-required", message: "A conversation id is required." });
				return;
			}

			try {
				let conversation = resolvedConversations.get(conversationId);
				if (!conversation) conversation = (await refreshConversations()).find((candidate) => candidate.id === conversationId);
				if (!conversation) {
					writeJson(res, 404, { code: "conversation-not-found", message: "Conversation not found." });
					return;
				}
				const events = await readEvents({
					filePath: conversation.filePath,
					sessionId: conversation.latestSessionId,
					maxEvents: MAX_EVENTS_PER_CONVERSATION,
				});
				writeJson(res, 200, { conversationId, sessionId: conversation.latestSessionId, events });
			} catch {
				writeJson(res, 500, { code: "conversation-events-failed", message: "Could not load conversation events." });
			}
		},
	};
}
