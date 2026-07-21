import type Graph from "graphology";

export type ConversationItem =
	| { kind: "message"; role: "user" | "assistant"; text: string; timestamp: number }
	| { kind: "turn-marker"; toolCallCount: number; timestamp: number }
	| {
			kind: "tool-call";
			toolCallId: string;
			toolName: string;
			request: unknown;
			response: unknown | undefined;
			timestamp: number;
	  }
	| { kind: "fallback"; bus: string; type: string; payload: unknown; timestamp: number };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getNumberAttr(graph: Graph, node: string, key: string): number {
	const value = graph.getNodeAttribute(node, key);
	return typeof value === "number" ? value : 0;
}

function getStringAttr(graph: Graph, node: string, key: string): string {
	const value = graph.getNodeAttribute(node, key);
	return typeof value === "string" ? value : "";
}

/**
 * Builds a readable conversation from the graphology trace graph — not raw
 * events — so ordering (Turn -> BusEvent) and tool-call pairing (shared
 * toolCallId) come from the graph structure the model task already built,
 * rather than being re-derived here.
 *
 * Per-event-type rendering, grounded in a real session's actual shapes (not
 * assumed): `sense/dialog.message` is the incoming user message,
 * `motor/dialog.message` is the assistant's dispatched reply,
 * `motor/llm.result` with a non-empty `toolCalls` array becomes a collapsed
 * turn marker (its `response` text, when tool calls follow, is usually empty
 * or preliminary — the real content arrives via the eventual dialog.message,
 * so rendering both would duplicate content). `sense/llm.result` carries no
 * payload in practice and is never rendered. Anything not recognized falls
 * back to a generic item instead of being dropped or crashing.
 */
export function buildConversationItems(graph: Graph): ConversationItem[] {
	const turnIds = graph.filterNodes((_node, attrs) => attrs.kind === "Turn");

	const turnsWithEvents = turnIds
		.map((turnId) => {
			const eventIds = graph.outNeighbors(turnId).filter((n) => graph.getNodeAttribute(n, "kind") === "BusEvent");
			const minTimestamp = eventIds.length > 0 ? Math.min(...eventIds.map((id) => getNumberAttr(graph, id, "timestamp"))) : 0;
			return { eventIds, minTimestamp };
		})
		.sort((a, b) => a.minTimestamp - b.minTimestamp);

	const items: ConversationItem[] = [];

	for (const { eventIds } of turnsWithEvents) {
		const sortedEventIds = [...eventIds].sort((a, b) => getNumberAttr(graph, a, "timestamp") - getNumberAttr(graph, b, "timestamp"));
		const toolCallItems = new Map<string, Extract<ConversationItem, { kind: "tool-call" }>>();

		for (const eventId of sortedEventIds) {
			const bus = getStringAttr(graph, eventId, "bus");
			const type = getStringAttr(graph, eventId, "type");
			const timestamp = getNumberAttr(graph, eventId, "timestamp");
			const payload: unknown = graph.getNodeAttribute(eventId, "payload");
			const toolCallIdAttr = graph.getNodeAttribute(eventId, "toolCallId");
			const toolCallId = typeof toolCallIdAttr === "string" ? toolCallIdAttr : undefined;

			if (toolCallId !== undefined) {
				const existing = toolCallItems.get(toolCallId);
				if (existing) {
					existing.response = payload;
				} else {
					const item: Extract<ConversationItem, { kind: "tool-call" }> = {
						kind: "tool-call",
						toolCallId,
						toolName: type,
						request: payload,
						response: undefined,
						timestamp,
					};
					toolCallItems.set(toolCallId, item);
					items.push(item);
				}
				continue;
			}

			if (type === "dialog.message") {
				const text = isRecord(payload) && typeof payload.text === "string" ? payload.text : "";
				const role = bus === "sense" ? "user" : "assistant";
				items.push({ kind: "message", role, text, timestamp });
				continue;
			}

			if (type === "llm.result") {
				const toolCalls = isRecord(payload) && Array.isArray(payload.toolCalls) ? payload.toolCalls : [];
				if (bus === "motor" && toolCalls.length > 0) {
					items.push({ kind: "turn-marker", toolCallCount: toolCalls.length, timestamp });
				}
				// sense/llm.result (empty payload) and motor/llm.result with no
				// tool calls carry nothing worth rendering on their own — the
				// dialog.message that follows carries the actual text.
				continue;
			}

			items.push({ kind: "fallback", bus, type, payload, timestamp });
		}
	}

	return items;
}

function renderItem(item: ConversationItem): string {
	switch (item.kind) {
		case "message":
			return renderMessage(item.role, item.text);
		case "turn-marker":
			return `
				<div class="text-xs text-gray-400 dark:text-gray-500 italic px-2 py-1">
					Assistant is using ${item.toolCallCount} tool${item.toolCallCount === 1 ? "" : "s"}…
				</div>
			`;
		case "tool-call":
			return renderToolCall(item.toolName, item.request, item.response);
		case "fallback":
			return `
				<div class="text-xs text-gray-400 dark:text-gray-500 px-2 py-1">
					<code>${item.bus}/${item.type}</code>: <code>${JSON.stringify(item.payload).slice(0, 160)}</code>
				</div>
			`;
	}
}

function renderMessage(role: "user" | "assistant", text: string): string {
	const isUser = role === "user";
	const bubbleClasses = isUser
		? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
		: "bg-accent-10 dark:bg-accent-80 text-gray-900 dark:text-gray-100";
	const label = isUser ? "User" : "Assistant";
	return `
		<div class="px-2 py-1">
			<p class="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">${label}</p>
			<div class="rounded-lg px-3 py-2 text-sm ${bubbleClasses} max-w-2xl whitespace-pre-wrap">${escapeHtml(text)}</div>
		</div>
	`;
}

function renderToolCall(toolName: string, request: unknown, response: unknown): string {
	const requestJson = JSON.stringify(request, null, 2);
	const responseJson = response !== undefined ? JSON.stringify(response, null, 2) : "(no response yet)";
	return `
		<div class="px-2 py-1">
			<details class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-sm">
				<summary class="px-3 py-2 cursor-pointer text-gray-600 dark:text-gray-300 font-medium">
					<code class="text-accent-50 dark:text-accent-30">${toolName}</code>
				</summary>
				<div class="px-3 pb-2 space-y-2">
					<div>
						<p class="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Request</p>
						<pre class="text-xs overflow-auto">${escapeHtml(requestJson)}</pre>
					</div>
					<div>
						<p class="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Response</p>
						<pre class="text-xs overflow-auto">${escapeHtml(responseJson)}</pre>
					</div>
				</div>
			</details>
		</div>
	`;
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderConversationView(container: HTMLElement, graph: Graph): void {
	const items = buildConversationItems(graph);
	container.innerHTML = `
		<div class="h-full overflow-auto p-3 space-y-1">
			${items.map(renderItem).join("")}
		</div>
	`;
}
