import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";

/** Semantic status colors stay distinct from the product accent; danger uses orange rather than brand red. */
export type EventStatus = "success" | "danger" | "warning" | "info" | "neutral";

export const STATUS_COLORS: Record<EventStatus, string> = {
	success: "#63993d",
	danger: "#f0561d",
	warning: "#ffcc17",
	info: "#5e40be",
	neutral: "#37a3a3",
};

/**
 * Non-color differentiator #1: node kind changes size, so Session/Turn/
 * ToolCall/BusEvent stay visually distinguishable even in grayscale or for
 * a color-blind viewer. Non-color differentiator #2 is the node label (kind prefix + id), always
 * rendered regardless of color.
 */
export const KIND_SIZE: Record<string, number> = {
	Session: 18,
	Turn: 12,
	ToolCall: 10,
	BusEvent: 6,
};

const KIND_LABEL_PREFIX: Record<string, string> = {
	Session: "Session",
	Turn: "Turn",
	ToolCall: "Tool",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Status heuristic for a single BusEvent. This is a heuristic over data that
 * has no universal "status" field, not an assertion of ground truth:
 * explicit `payload.isError` and error/fail/timeout-like type names are the
 * only strong signals available; bus channel (sense = an observation came
 * back, motor = a command was issued, signal = telemetry) is a weaker
 * fallback signal, grounded in the real bus semantics observed in Alef's
 * session data (see the graph model task and its doc).
 */
export function computeEventStatus(bus: string, type: string, payload: unknown): EventStatus {
	if (isRecord(payload) && payload.isError === true) return "danger";
	if (/error|fail|timeout/i.test(type)) return "danger";
	if (bus === "signal") return "warning";
	if (bus === "sense") return "success";
	if (bus === "motor") return "info";
	return "neutral";
}

/**
 * Aggregate status for a ToolCall node from its correlated BusEvents
 * (motor request + sense response, linked by the `correlates` edges the
 * graph model already built). Pending (request only, no response yet) is
 * treated as a warning -- worth a viewer's attention, not yet resolved.
 */
export function computeToolCallStatus(graph: Graph, toolCallNodeId: string): EventStatus {
	const correlatedEventIds = graph.inNeighbors(toolCallNodeId);
	if (correlatedEventIds.length < 2) return "warning";

	for (const eventId of correlatedEventIds) {
		const payload: unknown = graph.getNodeAttribute(eventId, "payload");
		const type: unknown = graph.getNodeAttribute(eventId, "type");
		const typeStr = typeof type === "string" ? type : "";
		if ((isRecord(payload) && payload.isError === true) || /error|fail/i.test(typeStr)) {
			return "danger";
		}
	}
	return "success";
}

/**
 * Produces a copy of the source graph annotated with everything sigma.js
 * needs to render it (x/y position, size, color, label) without mutating
 * the SessionGraph instance other views (the Conversation tile) also read
 * from -- rendering derives from the shared graph, it doesn't own it.
 */
// forceatlas2 requires non-degenerate starting positions; a simple circular
// seed is enough (graphology-layout wasn't worth adding as a dependency for
// a few lines of trig).
function seedCircularPositions(renderGraph: Graph, nodeIds: readonly string[]): void {
	const radius = 10;
	nodeIds.forEach((nodeId, index) => {
		const angle = (index / Math.max(nodeIds.length, 1)) * 2 * Math.PI;
		renderGraph.setNodeAttribute(nodeId, "x", radius * Math.cos(angle));
		renderGraph.setNodeAttribute(nodeId, "y", radius * Math.sin(angle));
	});
}

function computeNodeStatus(renderGraph: Graph, nodeId: string, kindStr: string): EventStatus {
	if (kindStr === "BusEvent") {
		const bus: unknown = renderGraph.getNodeAttribute(nodeId, "bus");
		const type: unknown = renderGraph.getNodeAttribute(nodeId, "type");
		const payload: unknown = renderGraph.getNodeAttribute(nodeId, "payload");
		return computeEventStatus(typeof bus === "string" ? bus : "", typeof type === "string" ? type : "", payload);
	}
	if (kindStr === "ToolCall") {
		return computeToolCallStatus(renderGraph, nodeId);
	}
	// Session/Turn are structural containers, not events -- they don't have a
	// success/failure status of their own.
	return "neutral";
}

/** Settles one node's size/status/color/label -- everything sigma.js needs to render it, computed together since status also drives color. */
function annotateNodeForRender(renderGraph: Graph, nodeId: string): void {
	const kind: unknown = renderGraph.getNodeAttribute(nodeId, "kind");
	const kindStr = typeof kind === "string" ? kind : "BusEvent";
	renderGraph.setNodeAttribute(nodeId, "size", KIND_SIZE[kindStr] ?? KIND_SIZE.BusEvent);

	const status = computeNodeStatus(renderGraph, nodeId, kindStr);
	renderGraph.setNodeAttribute(nodeId, "status", status);
	renderGraph.setNodeAttribute(nodeId, "color", STATUS_COLORS[status]);

	const existingLabel: unknown = renderGraph.getNodeAttribute(nodeId, "label");
	const labelStr = typeof existingLabel === "string" ? existingLabel : "";
	const prefix = KIND_LABEL_PREFIX[kindStr];
	renderGraph.setNodeAttribute(nodeId, "label", prefix ? `${prefix}: ${labelStr}` : labelStr);
}

/**
 * sigma.js reserves the `type` attribute name to select a node's rendering
 * program, and our own `type` (e.g. "dialog.message") collides with it,
 * throwing "could not find a suitable program for node type ..." at render
 * time otherwise -- rename it out of the way once rendering no longer needs
 * to read it as `type`.
 */
function renameTypeToEventType(renderGraph: Graph, nodeId: string): void {
	if (!renderGraph.hasNodeAttribute(nodeId, "type")) return;
	const eventType: unknown = renderGraph.getNodeAttribute(nodeId, "type");
	renderGraph.setNodeAttribute(nodeId, "eventType", eventType);
	renderGraph.removeNodeAttribute(nodeId, "type");
}

function styleEdge(renderGraph: Graph, edgeId: string): void {
	const relation: unknown = renderGraph.getEdgeAttribute(edgeId, "relation");
	const isCorrelates = relation === "correlates";
	renderGraph.setEdgeAttribute(edgeId, "size", isCorrelates ? 2 : 1);
	renderGraph.setEdgeAttribute(edgeId, "color", isCorrelates ? "#9ca3af" : "#d1d5db");
}

export function buildRenderGraph(sourceGraph: Graph): Graph {
	const renderGraph = sourceGraph.copy();
	const nodeIds = renderGraph.nodes();
	seedCircularPositions(renderGraph, nodeIds);

	if (nodeIds.length > 1) {
		forceAtlas2.assign(renderGraph, {
			iterations: 100,
			settings: forceAtlas2.inferSettings(renderGraph),
		});
	}

	// Two passes, deliberately: computeToolCallStatus reads the `type`
	// attribute off a ToolCall's *correlated* BusEvent nodes, so `type` must
	// stay intact on every node throughout pass 1, regardless of visit order.
	// Only after every node's status/size/color/label is settled (pass 1) do
	// we rename `type` out of sigma.js's way (pass 2).
	for (const nodeId of renderGraph.nodes()) annotateNodeForRender(renderGraph, nodeId);
	for (const nodeId of renderGraph.nodes()) renameTypeToEventType(renderGraph, nodeId);
	for (const edgeId of renderGraph.edges()) styleEdge(renderGraph, edgeId);

	return renderGraph;
}
