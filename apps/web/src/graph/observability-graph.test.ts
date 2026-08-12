import Graph from "graphology";
import { describe, expect, it } from "vitest";
import {
	buildRenderGraph,
	computeEventStatus,
	computeToolCallStatus,
	KIND_SIZE,
	STATUS_COLORS,
} from "./observability-graph.js";

describe("computeEventStatus — status heuristic for BusEvent nodes", () => {
	it("classifies an explicit isError payload as danger, never red", () => {
		expect(computeEventStatus("sense", "fs.read", { isError: true })).toBe("danger");
		expect(STATUS_COLORS.danger).toBe("#f0561d"); // Red Hat danger-orange, not red
	});

	it("classifies a type containing error/fail/timeout as danger", () => {
		expect(computeEventStatus("motor", "tool.timeout", {})).toBe("danger");
		expect(computeEventStatus("sense", "extension_error", {})).toBe("danger");
	});

	it("classifies signal-bus events as warning", () => {
		expect(computeEventStatus("signal", "telemetry.tick", {})).toBe("warning");
	});

	it("classifies sense-bus events (observations/responses) as success", () => {
		expect(computeEventStatus("sense", "fs.read", { content: "ok" })).toBe("success");
	});

	it("classifies motor-bus events (commands issued) as info", () => {
		expect(computeEventStatus("motor", "fs.read", { path: "x" })).toBe("info");
	});

	it("falls back to neutral for anything else (e.g. debug bus)", () => {
		expect(computeEventStatus("debug", "trace-event", {})).toBe("neutral");
	});
});

describe("computeToolCallStatus — aggregate status from correlated events", () => {
	function buildGraph(): { graph: Graph; toolCallId: string } {
		const graph = new Graph({ type: "directed" });
		graph.addNode("tool-call:s1:tc-1", { kind: "ToolCall", label: "tc-1" });
		return { graph, toolCallId: "tool-call:s1:tc-1" };
	}

	it("is warning (pending) when only a request has arrived so far", () => {
		const { graph, toolCallId } = buildGraph();
		graph.addNode("event:1", { kind: "BusEvent", bus: "motor", type: "fs.read", payload: {} });
		graph.addDirectedEdge("event:1", toolCallId, { relation: "correlates" });

		expect(computeToolCallStatus(graph, toolCallId)).toBe("warning");
	});

	it("is success when a response has arrived with no error", () => {
		const { graph, toolCallId } = buildGraph();
		graph.addNode("event:1", { kind: "BusEvent", bus: "motor", type: "fs.read", payload: {} });
		graph.addNode("event:2", { kind: "BusEvent", bus: "sense", type: "fs.read", payload: { content: "ok" } });
		graph.addDirectedEdge("event:1", toolCallId, { relation: "correlates" });
		graph.addDirectedEdge("event:2", toolCallId, { relation: "correlates" });

		expect(computeToolCallStatus(graph, toolCallId)).toBe("success");
	});

	it("is danger when the response indicates an error", () => {
		const { graph, toolCallId } = buildGraph();
		graph.addNode("event:1", { kind: "BusEvent", bus: "motor", type: "fs.read", payload: {} });
		graph.addNode("event:2", { kind: "BusEvent", bus: "sense", type: "fs.read", payload: { isError: true } });
		graph.addDirectedEdge("event:1", toolCallId, { relation: "correlates" });
		graph.addDirectedEdge("event:2", toolCallId, { relation: "correlates" });

		expect(computeToolCallStatus(graph, toolCallId)).toBe("danger");
	});
});

describe("buildRenderGraph — non-mutating, kind-sized, positioned, colored", () => {
	function sampleGraph(): Graph {
		const graph = new Graph({ type: "directed" });
		graph.addNode("session:s1", { kind: "Session", label: "s1" });
		graph.addNode("turn:s1:c1", { kind: "Turn", label: "c1" });
		graph.addNode("event:1", { kind: "BusEvent", bus: "sense", type: "dialog.message", payload: {}, timestamp: 1 });
		graph.addNode("tool-call:s1:tc-1", { kind: "ToolCall", label: "tc-1" });
		graph.addDirectedEdge("session:s1", "turn:s1:c1", { relation: "contains" });
		graph.addDirectedEdge("turn:s1:c1", "event:1", { relation: "contains" });
		graph.addDirectedEdge("event:1", "tool-call:s1:tc-1", { relation: "correlates" });
		return graph;
	}

	it("does not mutate the source graph passed in", () => {
		const source = sampleGraph();
		buildRenderGraph(source);
		expect(source.hasNodeAttribute("session:s1", "x")).toBe(false);
		expect(source.hasNodeAttribute("session:s1", "color")).toBe(false);
	});

	it("assigns every node an x/y position, a size, and a color", () => {
		const rendered = buildRenderGraph(sampleGraph());
		for (const node of rendered.nodes()) {
			expect(typeof rendered.getNodeAttribute(node, "x")).toBe("number");
			expect(typeof rendered.getNodeAttribute(node, "y")).toBe("number");
			expect(typeof rendered.getNodeAttribute(node, "size")).toBe("number");
			expect(typeof rendered.getNodeAttribute(node, "color")).toBe("string");
		}
	});

	it("sizes nodes by kind, not uniformly -- Session is visually distinguishable from BusEvent even without color", () => {
		const rendered = buildRenderGraph(sampleGraph());
		const sessionSize = rendered.getNodeAttribute("session:s1", "size");
		const eventSize = rendered.getNodeAttribute("event:1", "size");
		expect(sessionSize).toBe(KIND_SIZE.Session);
		expect(eventSize).toBe(KIND_SIZE.BusEvent);
		expect(sessionSize).toBeGreaterThan(eventSize);
	});

	it("gives structural nodes (Session/Turn) a neutral color, not a status color", () => {
		const rendered = buildRenderGraph(sampleGraph());
		expect(rendered.getNodeAttribute("session:s1", "color")).toBe(STATUS_COLORS.neutral);
		expect(rendered.getNodeAttribute("turn:s1:c1", "color")).toBe(STATUS_COLORS.neutral);
	});

	it("never leaves a node attribute named 'type' -- sigma.js reserves that name for choosing a node's rendering program and throws if it doesn't recognize the value (e.g. our own event type 'dialog.message')", () => {
		const rendered = buildRenderGraph(sampleGraph());
		for (const node of rendered.nodes()) {
			expect(rendered.hasNodeAttribute(node, "type")).toBe(false);
		}
		// the original event type is preserved under a non-colliding name
		expect(rendered.getNodeAttribute("event:1", "eventType")).toBe("dialog.message");
	});

	it("never uses red anywhere in the color set", () => {
		for (const color of Object.values(STATUS_COLORS)) {
			expect(color.toLowerCase()).not.toBe("#ff0000");
			expect(color.toLowerCase()).not.toBe("#ee0000");
		}
	});
});
