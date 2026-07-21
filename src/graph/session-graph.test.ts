import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSessionJsonlSource } from "../ingest/session-jsonl-source.js";
import type { NormalizedEvent } from "../ingest/types.js";
import { SessionGraph } from "./session-graph.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../../test/fixtures/session-sample.jsonl");

async function loadFixtureEvents(): Promise<NormalizedEvent[]> {
	const events: NormalizedEvent[] = [];
	const source = createSessionJsonlSource({ filePath: FIXTURE, sessionId: "test-session" });
	const handle = source.ingest((event) => events.push(event));
	await new Promise((resolve) => setTimeout(resolve, 200));
	handle.dispose();
	return events;
}

describe("SessionGraph — building the trace graph from real ingestion output", () => {
	it("builds one Session node, one Turn node per distinct correlationId, and one BusEvent node per event", async () => {
		const events = await loadFixtureEvents();
		const graph = new SessionGraph();
		for (const event of events) graph.ingest(event);

		const sessionNodes = graph.nodesOfKind("Session");
		const turnNodes = graph.nodesOfKind("Turn");
		const busEventNodes = graph.nodesOfKind("BusEvent");

		expect(sessionNodes).toHaveLength(1);
		// the fixture has two distinct correlationIds (two turns)
		expect(turnNodes).toHaveLength(2);
		// 10 well-formed lines in the fixture
		expect(busEventNodes).toHaveLength(10);
	});

	it("merges motor/sense events sharing a toolCallId into one ToolCall node, correlated to both", async () => {
		const events = await loadFixtureEvents();
		const graph = new SessionGraph();
		for (const event of events) graph.ingest(event);

		const toolCallNodes = graph.nodesOfKind("ToolCall");
		expect(toolCallNodes).toHaveLength(1);

		const toolCallId = toolCallNodes[0];
		expect(toolCallId).toBeDefined();
		const correlatedEvents = graph.graph.inNeighbors(toolCallId as string);
		expect(correlatedEvents).toHaveLength(2);
		for (const nodeId of correlatedEvents) {
			expect(graph.graph.getNodeAttribute(nodeId, "kind")).toBe("BusEvent");
			expect(graph.graph.getNodeAttribute(nodeId, "type")).toBe("fs.read");
		}
	});

	it("chains BusEvents within the same Turn with precedes edges, in timestamp order", async () => {
		const events = await loadFixtureEvents();
		const graph = new SessionGraph();
		for (const event of events) graph.ingest(event);

		// turn 1 has 8 events -> 7 precedes edges; turn 2 has 2 events -> 1 precedes edge
		const precedesEdges = graph.graph.edges().filter((edge) => graph.graph.getEdgeAttribute(edge, "relation") === "precedes");
		expect(precedesEdges).toHaveLength(8);

		for (const edge of precedesEdges) {
			const source = graph.graph.source(edge);
			const target = graph.graph.target(edge);
			const sourceTs = graph.graph.getNodeAttribute(source, "timestamp") as number;
			const targetTs = graph.graph.getNodeAttribute(target, "timestamp") as number;
			expect(sourceTs).toBeLessThanOrEqual(targetTs);
		}
	});

	it("has the expected total edge count: contains (session->turn, turn->event) + correlates (event->toolcall) + precedes", async () => {
		const events = await loadFixtureEvents();
		const graph = new SessionGraph();
		for (const event of events) graph.ingest(event);

		// contains: 2 (session->turn) + 10 (turn->event) = 12
		// correlates: 2 (the two fs.read events -> the one tool call)
		// precedes: 8
		expect(graph.graph.size).toBe(12 + 2 + 8);
	});

	it("is idempotent: re-ingesting the same events produces no new nodes or edges", async () => {
		const events = await loadFixtureEvents();
		const graph = new SessionGraph();
		for (const event of events) graph.ingest(event);

		const orderBefore = graph.graph.order;
		const sizeBefore = graph.graph.size;

		for (const event of events) graph.ingest(event);

		expect(graph.graph.order).toBe(orderBefore);
		expect(graph.graph.size).toBe(sizeBefore);
	});
});
