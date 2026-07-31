import type Graph from "graphology";

export type ConversationItem =
	| { kind: "message"; role: "user" | "assistant"; text: string; timestamp: number }
	| { kind: "turn-marker"; toolCallCount: number; timestamp: number }
	| {
			kind: "tool-call";
			toolCallId: string;
			toolName: string;
			request: unknown;
			response: unknown;
			timestamp: number;
	  }
	| { kind: "fallback"; bus: string; type: string; payload: unknown; timestamp: number };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getNumberAttr(graph: Graph, node: string, key: string): number {
	const value: unknown = graph.getNodeAttribute(node, key);
	return typeof value === "number" ? value : 0;
}

function getStringAttr(graph: Graph, node: string, key: string): string {
	const value: unknown = graph.getNodeAttribute(node, key);
	return typeof value === "string" ? value : "";
}

interface EventAttrs {
	bus: string;
	type: string;
	timestamp: number;
	payload: unknown;
	toolCallId: string | undefined;
}

function readEventAttrs(graph: Graph, eventId: string): EventAttrs {
	const toolCallIdAttr: unknown = graph.getNodeAttribute(eventId, "toolCallId");
	return {
		bus: getStringAttr(graph, eventId, "bus"),
		type: getStringAttr(graph, eventId, "type"),
		timestamp: getNumberAttr(graph, eventId, "timestamp"),
		payload: graph.getNodeAttribute(eventId, "payload") as unknown,
		toolCallId: typeof toolCallIdAttr === "string" ? toolCallIdAttr : undefined,
	};
}

/** One turn's BusEvent ids, sorted by timestamp. */
function sortedTurnEventIds(graph: Graph): string[][] {
	const turnIds = graph.filterNodes((_node, attrs) => attrs.kind === "Turn");
	return turnIds
		.map((turnId) => {
			const eventIds = graph.outNeighbors(turnId).filter((n) => graph.getNodeAttribute(n, "kind") === "BusEvent");
			const minTimestamp = eventIds.length > 0 ? Math.min(...eventIds.map((id) => getNumberAttr(graph, id, "timestamp"))) : 0;
			const sorted = [...eventIds].sort((a, b) => getNumberAttr(graph, a, "timestamp") - getNumberAttr(graph, b, "timestamp"));
			return { sorted, minTimestamp };
		})
		.sort((a, b) => a.minTimestamp - b.minTimestamp)
		.map(({ sorted }) => sorted);
}

type ToolCallItem = Extract<ConversationItem, { kind: "tool-call" }>;

/**
 * Pairs a tool-call event (its request and, once the matching response event
 * arrives, its response) into a single item shared by both — rather than two
 * separate items a reader would have to mentally re-join.
 */
function projectToolCallEvent(toolCallItems: Map<string, ToolCallItem>, items: ConversationItem[], attrs: EventAttrs, toolCallId: string): void {
	const existing = toolCallItems.get(toolCallId);
	if (existing) {
		existing.response = attrs.payload;
		return;
	}
	const item: ToolCallItem = {
		kind: "tool-call",
		toolCallId,
		toolName: attrs.type,
		request: attrs.payload,
		response: undefined,
		timestamp: attrs.timestamp,
	};
	toolCallItems.set(toolCallId, item);
	items.push(item);
}

function projectDialogMessage(items: ConversationItem[], attrs: EventAttrs): void {
	const text = isRecord(attrs.payload) && typeof attrs.payload.text === "string" ? attrs.payload.text : "";
	const role = attrs.bus === "sense" ? "user" : "assistant";
	items.push({ kind: "message", role, text, timestamp: attrs.timestamp });
}

/**
 * `motor/llm.result` with a non-empty `toolCalls` array becomes a collapsed
 * turn marker (its `response` text, when tool calls follow, is usually empty
 * or preliminary — the real content arrives via the eventual dialog.message,
 * so rendering both would duplicate content). `sense/llm.result` carries no
 * payload in practice and is never rendered.
 */
function projectLlmResult(items: ConversationItem[], attrs: EventAttrs): void {
	const toolCalls = isRecord(attrs.payload) && Array.isArray(attrs.payload.toolCalls) ? attrs.payload.toolCalls : [];
	if (attrs.bus === "motor" && toolCalls.length > 0) {
		items.push({ kind: "turn-marker", toolCallCount: toolCalls.length, timestamp: attrs.timestamp });
	}
}

function projectEvent(toolCallItems: Map<string, ToolCallItem>, items: ConversationItem[], attrs: EventAttrs): void {
	if (attrs.toolCallId !== undefined) {
		projectToolCallEvent(toolCallItems, items, attrs, attrs.toolCallId);
	} else if (attrs.type === "dialog.message") {
		projectDialogMessage(items, attrs);
	} else if (attrs.type === "llm.result") {
		projectLlmResult(items, attrs);
	} else {
		items.push({ kind: "fallback", bus: attrs.bus, type: attrs.type, payload: attrs.payload, timestamp: attrs.timestamp });
	}
}

/**
 * Builds a readable conversation from the graphology trace graph — not raw
 * events — so ordering (Turn -> BusEvent) and tool-call pairing (shared
 * toolCallId) come from the graph structure the model task already built,
 * rather than being re-derived here. Per-event-type projection (tool-call
 * pairing, dialog messages, collapsed turn markers, fallback) is grounded in
 * a real session's actual shapes, not assumed; anything unrecognized falls
 * back to a generic item instead of being dropped or crashing.
 */
export function buildConversationItems(graph: Graph): ConversationItem[] {
	const items: ConversationItem[] = [];

	for (const sortedEventIds of sortedTurnEventIds(graph)) {
		const toolCallItems = new Map<string, ToolCallItem>();
		for (const eventId of sortedEventIds) {
			projectEvent(toolCallItems, items, readEventAttrs(graph, eventId));
		}
	}

	return items;
}

