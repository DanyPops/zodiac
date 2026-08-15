import { TraceGraph } from "./trace-graph.js";
import type { NormalizedEvent } from "../ingest/types.js";

/**
 * Node kinds in the trace graph.
 *
 * Corrected against real Alef session data (not the initial assumption):
 * `correlationId` groups a WHOLE turn's exchange (llm.input -> llm.result
 * -> tool calls -> llm.response; older sessions used dialog.message instead),
 * not a single motor/sense pair. The
 * finer-grained pairing key for one tool call's request/response is
 * `payload.toolCallId`. This graph models both: Turn nodes group by
 * correlationId, ToolCall nodes group by toolCallId.
 */
export type NodeKind = "Session" | "Turn" | "BusEvent" | "ToolCall";

/** Edge relations in the trace graph. */
export type EdgeRelation = "contains" | "correlates" | "precedes";

function sessionNodeId(sessionId: string): string {
	return `session:${sessionId}`;
}

function turnNodeId(sessionId: string, correlationId: string): string {
	return `turn:${sessionId}:${correlationId}`;
}

function toolCallNodeId(sessionId: string, toolCallId: string): string {
	return `tool-call:${sessionId}:${toolCallId}`;
}

/**
 * Deterministic, content-based id for a single event, so re-ingesting the
 * same line (from a re-read historical file, or a live tail overlapping a
 * later historical read) resolves to the same node instead of duplicating
 * it. Not a cryptographic hash — collision resistance only needs to hold
 * within one session's event stream.
 */
function busEventNodeId(event: NormalizedEvent): string {
	const key = JSON.stringify({
		bus: event.bus,
		type: event.type,
		correlationId: event.correlationId,
		payload: event.payload,
		timestamp: event.timestamp,
		elapsed: event.elapsed,
		hash: event.hash,
	});
	let hash = 5381;
	for (let i = 0; i < key.length; i++) {
		hash = (hash * 33) ^ key.charCodeAt(i);
	}
	return `event:${event.sessionId}:${(hash >>> 0).toString(36)}`;
}

/**
 * Maintains a TraceGraph of Session/Turn/BusEvent/ToolCall nodes built from
 * a stream of NormalizedEvents. Idempotent: ingesting the same event twice
 * (from any combination of sources) adds no new nodes or edges.
 */
export class SessionGraph {
	readonly graph = new TraceGraph();
	/** Tracks the most recent BusEvent node per Turn, to chain `precedes` edges as events arrive. */
	private readonly lastEventByTurn = new Map<string, string>();

	/** Ingest one normalized event, updating the graph. Safe to call multiple times with the same event. */
	ingest(event: NormalizedEvent): void {
		const sessionId = sessionNodeId(event.sessionId);
		this.ensureNode(sessionId, "Session", { label: event.sessionId, sessionId: event.sessionId });

		const turnId = turnNodeId(event.sessionId, event.correlationId);
		this.ensureNode(turnId, "Turn", {
			label: event.correlationId,
			sessionId: event.sessionId,
			correlationId: event.correlationId,
		});
		this.ensureEdge(sessionId, turnId, "contains");

		const eventId = busEventNodeId(event);
		const isNewEvent = !this.graph.hasNode(eventId);
		if (isNewEvent) {
			this.graph.addNode(eventId, {
				kind: "BusEvent" satisfies NodeKind,
				label: `${event.bus}/${event.type}`,
				bus: event.bus,
				type: event.type,
				correlationId: event.correlationId,
				timestamp: event.timestamp,
				elapsed: event.elapsed,
				hash: event.hash,
				toolCallId: event.toolCallId,
				payload: event.payload,
			});
		}
		this.ensureEdge(turnId, eventId, "contains");

		if (event.toolCallId) {
			const toolCallId = toolCallNodeId(event.sessionId, event.toolCallId);
			this.ensureNode(toolCallId, "ToolCall", {
				label: event.toolCallId,
				sessionId: event.sessionId,
				toolCallId: event.toolCallId,
			});
			this.ensureEdge(eventId, toolCallId, "correlates");
		}

		if (isNewEvent) {
			const previousEventId = this.lastEventByTurn.get(turnId);
			if (previousEventId !== undefined) {
				this.ensureEdge(previousEventId, eventId, "precedes");
			}
			this.lastEventByTurn.set(turnId, eventId);
		}
	}

	/** All node ids of a given kind, in insertion order. */
	nodesOfKind(kind: NodeKind): string[] {
		return this.graph.filterNodes((_node, attrs) => attrs.kind === kind);
	}

	private ensureNode(id: string, kind: NodeKind, attributes: Record<string, unknown>): void {
		if (!this.graph.hasNode(id)) {
			this.graph.addNode(id, { kind, ...attributes });
		}
	}

	private ensureEdge(source: string, target: string, relation: EdgeRelation): void {
		if (!this.graph.hasDirectedEdge(source, target)) {
			this.graph.addDirectedEdge(source, target, { relation });
		}
	}
}
