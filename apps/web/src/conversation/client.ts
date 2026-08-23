import type { NormalizedEvent } from "@zodiac/server/conversations";

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

export interface CreateHttpConversationClientOptions {
	readonly fetcher?: typeof fetch;
	/** Base URL of the running zodiacd instance, e.g. http://127.0.0.1:4390. Defaults to same-origin (empty string) -- App.tsx's composition root supplies the real configured value via resolveZodiacdBaseUrl(). */
	readonly baseUrl?: string;
}

export function createHttpConversationClient(options: CreateHttpConversationClientOptions = {}): ConversationClient {
	const fetcher = options.fetcher ?? fetch;
	const baseUrl = options.baseUrl ?? "";
	return {
		async list(signal) {
			const response = await fetcher(`${baseUrl}/api/conversations`, { signal });
			if (!response.ok) throw new Error(`conversation-list:${response.status}`);
			return parseConversationList(await response.json());
		},
		async loadEvents(conversationId, signal) {
			const response = await fetcher(`${baseUrl}/api/conversations/events?conversationId=${encodeURIComponent(conversationId)}`, { signal });
			if (!response.ok) throw new Error(`conversation-events:${response.status}`);
			return parseEvents(await response.json());
		},
	};
}

/** Bounded, not because a real deployment is expected to hit it, but because an unvalidated array length from a network response is an unbounded-memory-allocation risk regardless of how well-typed each individual element is. */
const MAX_CONVERSATIONS = 10_000;
const MAX_EVENTS = 10_000;

function parseConversationList(value: unknown): ConversationSummary[] {
	if (!isRecord(value) || !Array.isArray(value.conversations)) throw new Error("invalid-conversation-list");
	if (value.conversations.length > MAX_CONVERSATIONS) throw new Error(`invalid-conversation-list:exceeds-max-${MAX_CONVERSATIONS}`);
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
	if (value.events.length > MAX_EVENTS) throw new Error(`invalid-conversation-events:exceeds-max-${MAX_EVENTS}`);
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
