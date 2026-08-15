import { describe, expect, it } from "vitest";
import { TraceGraph } from "./trace-graph.js";

describe("TraceGraph", () => {
	it("reports a node as absent until added, then present with its own attributes", () => {
		const graph = new TraceGraph();
		expect(graph.hasNode("a")).toBe(false);
		graph.addNode("a", { kind: "Session", label: "s1" });
		expect(graph.hasNode("a")).toBe(true);
		expect(graph.getNodeAttribute("a", "kind")).toBe("Session");
		expect(graph.getNodeAttribute("a", "label")).toBe("s1");
	});

	it("getNodeAttribute on an unknown node or key returns undefined, never throws", () => {
		const graph = new TraceGraph();
		expect(graph.getNodeAttribute("missing", "kind")).toBeUndefined();
		graph.addNode("a", { kind: "Session" });
		expect(graph.getNodeAttribute("a", "notSet")).toBeUndefined();
	});

	it("reports a directed edge as absent until added, then present -- direction matters", () => {
		const graph = new TraceGraph();
		graph.addNode("a", {});
		graph.addNode("b", {});
		expect(graph.hasDirectedEdge("a", "b")).toBe(false);
		graph.addDirectedEdge("a", "b", { relation: "contains" });
		expect(graph.hasDirectedEdge("a", "b")).toBe(true);
		expect(graph.hasDirectedEdge("b", "a")).toBe(false);
	});

	it("outNeighbors returns targets in the order edges were added, deduplicated", () => {
		const graph = new TraceGraph();
		graph.addDirectedEdge("turn", "event-1", { relation: "contains" });
		graph.addDirectedEdge("turn", "event-2", { relation: "contains" });
		graph.addDirectedEdge("turn", "event-1", { relation: "contains" }); // re-adding the same edge is a no-op, not a duplicate
		expect(graph.outNeighbors("turn")).toEqual(["event-1", "event-2"]);
	});

	it("outNeighbors on a node with no outgoing edges is an empty array", () => {
		const graph = new TraceGraph();
		graph.addNode("lonely", {});
		expect(graph.outNeighbors("lonely")).toEqual([]);
	});

	it("inNeighbors returns sources of every edge pointing at a node", () => {
		const graph = new TraceGraph();
		graph.addDirectedEdge("event-1", "tool-call", { relation: "correlates" });
		graph.addDirectedEdge("event-2", "tool-call", { relation: "correlates" });
		expect(graph.inNeighbors("tool-call").sort()).toEqual(["event-1", "event-2"]);
		expect(graph.inNeighbors("event-1")).toEqual([]);
	});

	it("filterNodes returns every node id whose attributes satisfy the predicate", () => {
		const graph = new TraceGraph();
		graph.addNode("a", { kind: "Turn" });
		graph.addNode("b", { kind: "BusEvent" });
		graph.addNode("c", { kind: "Turn" });
		expect(graph.filterNodes((_id, attrs) => attrs.kind === "Turn")).toEqual(["a", "c"]);
	});

	it("edges() lists every edge id once, each resolvable via source/target/getEdgeAttribute", () => {
		const graph = new TraceGraph();
		graph.addDirectedEdge("a", "b", { relation: "precedes" });
		graph.addDirectedEdge("b", "c", { relation: "precedes" });
		const edges = graph.edges();
		expect(edges).toHaveLength(2);
		for (const edge of edges) {
			expect(graph.getEdgeAttribute(edge, "relation")).toBe("precedes");
		}
		expect(graph.source(edges[0]!)).toBe("a");
		expect(graph.target(edges[0]!)).toBe("b");
		expect(graph.source(edges[1]!)).toBe("b");
		expect(graph.target(edges[1]!)).toBe("c");
	});

	it("re-adding the same directed edge does not grow edges() or change its own id", () => {
		const graph = new TraceGraph();
		graph.addDirectedEdge("a", "b", { relation: "contains" });
		const [firstId] = graph.edges();
		graph.addDirectedEdge("a", "b", { relation: "contains" });
		expect(graph.edges()).toEqual([firstId]);
	});

	it("order and size count nodes and edges, unaffected by re-adding an existing one of either", () => {
		const graph = new TraceGraph();
		expect(graph.order).toBe(0);
		expect(graph.size).toBe(0);
		graph.addNode("a", {});
		graph.addNode("b", {});
		graph.addDirectedEdge("a", "b", { relation: "contains" });
		expect(graph.order).toBe(2);
		expect(graph.size).toBe(1);
		graph.addNode("a", {});
		graph.addDirectedEdge("a", "b", { relation: "contains" });
		expect(graph.order).toBe(2);
		expect(graph.size).toBe(1);
	});
});
