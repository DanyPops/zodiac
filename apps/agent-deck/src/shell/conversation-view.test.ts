import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import Graph from "graphology";
import { SessionGraph } from "../graph/session-graph.js";
import { createSessionJsonlSource } from "../ingest/session-jsonl-source.js";
import type { NormalizedEvent } from "../ingest/types.js";
import { buildConversationItems } from "./conversation-view.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../../test/fixtures/session-sample.jsonl");

async function loadFixtureGraph(): Promise<Graph> {
	const events: NormalizedEvent[] = [];
	const source = createSessionJsonlSource({ filePath: FIXTURE, sessionId: "test-session" });
	const handle = source.ingest((event) => events.push(event));
	await new Promise((resolve) => setTimeout(resolve, 200));
	handle.dispose();

	const sessionGraph = new SessionGraph();
	for (const event of events) sessionGraph.ingest(event);
	return sessionGraph.graph;
}

describe("buildConversationItems — against the real fixture", () => {
	it("renders dialog.message as user/assistant messages, tool calls as merged cards, and llm.result as a collapsed turn-marker only when it carries tool calls", async () => {
		const graph = await loadFixtureGraph();
		const items = buildConversationItems(graph);

		// sense/llm.result (empty payload) is never rendered; motor/llm.result
		// with an empty toolCalls array is also skipped (its content duplicates
		// the dialog.message that follows) — only 6 renderable items total.
		expect(items).toHaveLength(6);

		expect(items[0]).toMatchObject({ kind: "message", role: "user", text: "Please read the readme" });
		expect(items[1]).toMatchObject({ kind: "turn-marker", toolCallCount: 1 });

		const toolCallItem = items[2];
		expect(toolCallItem?.kind).toBe("tool-call");
		if (toolCallItem?.kind === "tool-call") {
			expect(toolCallItem.toolCallId).toBe("tc-1");
			expect(toolCallItem.toolName).toBe("fs.read");
			expect(toolCallItem.request).toMatchObject({ path: "example-readme.md" });
			expect(toolCallItem.response).toMatchObject({ content: "# Example\n" });
		}

		expect(items[3]).toMatchObject({ kind: "message", role: "assistant", text: "The readme says hello." });
		expect(items[4]).toMatchObject({ kind: "message", role: "user", text: "Thanks" });
		expect(items[5]).toMatchObject({ kind: "message", role: "assistant", text: "You're welcome!" });
	});

	it("orders items across turns by timestamp, not graph insertion order", async () => {
		const graph = await loadFixtureGraph();
		const items = buildConversationItems(graph);
		const timestamps = items.map((item) => item.timestamp);
		const sorted = [...timestamps].sort((a, b) => a - b);
		expect(timestamps).toEqual(sorted);
	});
});

describe("buildConversationItems — unrecognized event types", () => {
	it("falls back to a generic item instead of crashing on an unknown bus/type", () => {
		const graph = new Graph({ type: "directed" });
		graph.addNode("session:s1", { kind: "Session", label: "s1" });
		graph.addNode("turn:s1:c1", { kind: "Turn", label: "c1" });
		graph.addDirectedEdge("session:s1", "turn:s1:c1", { relation: "contains" });

		graph.addNode("event:s1:1", {
			kind: "BusEvent",
			bus: "signal",
			type: "some.unrecognized.thing",
			correlationId: "c1",
			timestamp: 1000,
			payload: { anything: "goes here" },
		});
		graph.addDirectedEdge("turn:s1:c1", "event:s1:1", { relation: "contains" });

		const items = buildConversationItems(graph);

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			kind: "fallback",
			bus: "signal",
			type: "some.unrecognized.thing",
		});
	});
});
