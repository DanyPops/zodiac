import type { NormalizedEvent } from "../ingest/types.js";

export interface ConversationSummary {
	id: string;
	name?: string;
	latestSessionId: string;
	lastActiveAt: string;
	totalTurns: number;
	totalErrors: number;
}

/**
 * Driven port: the Workspace application layer's own view of "a place
 * Conversations live," independent of HTTP. `createHttpConversationClient`
 * is its only adapter today; a test double or a future local-daemon adapter
 * implements the same interface without either side knowing about fetch.
 */
export interface ConversationClient {
	list: (signal?: AbortSignal) => Promise<ConversationSummary[]>;
	loadEvents: (conversationId: string, signal?: AbortSignal) => Promise<NormalizedEvent[]>;
}

export function createHttpConversationClient(fetcher: typeof fetch = fetch): ConversationClient {
	return {
		async list(signal) {
			const response = await fetcher("/api/conversations", { signal });
			if (!response.ok) throw new Error(`conversation-list:${response.status}`);
			return parseConversationList(await response.json());
		},
		async loadEvents(conversationId, signal) {
			const response = await fetcher(`/api/events?conversationId=${encodeURIComponent(conversationId)}`, { signal });
			if (!response.ok) throw new Error(`conversation-events:${response.status}`);
			return parseEvents(await response.json());
		},
	};
}

function parseConversationList(value: unknown): ConversationSummary[] {
	if (!isRecord(value) || !Array.isArray(value.conversations)) throw new Error("invalid-conversation-list");
	return value.conversations.map((item, index) => parseConversation(item, index));
}

function parseConversation(value: unknown, index: number): ConversationSummary {
	if (!isRecord(value)) throw new Error(`invalid-conversation:${index}`);
	const requiredStrings = ["id", "latestSessionId", "lastActiveAt"] as const;
	for (const key of requiredStrings) if (typeof value[key] !== "string") throw new Error(`invalid-conversation:${index}:${key}`);
	if (value.name !== undefined && typeof value.name !== "string") throw new Error(`invalid-conversation:${index}:name`);
	if (typeof value.totalTurns !== "number" || typeof value.totalErrors !== "number") throw new Error(`invalid-conversation:${index}:counts`);
	return {
		id: value.id as string,
		name: value.name,
		latestSessionId: value.latestSessionId as string,
		lastActiveAt: value.lastActiveAt as string,
		totalTurns: value.totalTurns,
		totalErrors: value.totalErrors,
	};
}

function parseEvents(value: unknown): NormalizedEvent[] {
	if (!isRecord(value) || !Array.isArray(value.events)) throw new Error("invalid-conversation-events");
	return value.events.map((event, index) => {
		if (!isRecord(event)) throw new Error(`invalid-event:${index}`);
		for (const key of ["sourceId", "sessionId", "bus", "type", "correlationId"] as const) {
			if (typeof event[key] !== "string") throw new Error(`invalid-event:${index}:${key}`);
		}
		if (typeof event.timestamp !== "number") throw new Error(`invalid-event:${index}:timestamp`);
		if (event.elapsed !== undefined && typeof event.elapsed !== "number") throw new Error(`invalid-event:${index}:elapsed`);
		if (event.hash !== undefined && typeof event.hash !== "string") throw new Error(`invalid-event:${index}:hash`);
		if (event.toolCallId !== undefined && typeof event.toolCallId !== "string") throw new Error(`invalid-event:${index}:toolCallId`);
		return {
			sourceId: event.sourceId as string,
			sessionId: event.sessionId as string,
			bus: event.bus as string,
			type: event.type as string,
			correlationId: event.correlationId as string,
			payload: event.payload,
			timestamp: event.timestamp,
			elapsed: event.elapsed,
			hash: event.hash,
			toolCallId: event.toolCallId,
		};
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
