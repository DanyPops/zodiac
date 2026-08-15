import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TraceGraph } from "../graph/trace-graph.js";
import { SessionGraph } from "../graph/session-graph.js";
import { createSessionJsonlSource } from "../ingest/session-jsonl-source.js";
import type { NormalizedEvent } from "../ingest/types.js";
import type { ConversationItem } from "./projector.js";
import { buildConversationItems, latestToolCallName } from "./projector.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../../test/fixtures/session-sample.jsonl");

async function loadFixtureGraph(): Promise<TraceGraph> {
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


function addBusEvent(graph: TraceGraph, id: string, bus: string, type: string, payload: unknown, timestamp: number, toolCallId?: string): void {
	if (!graph.hasNode("session:s1")) graph.addNode("session:s1", { kind: "Session", label: "s1" });
	if (!graph.hasNode("turn:s1:c1")) {
		graph.addNode("turn:s1:c1", { kind: "Turn", label: "c1" });
		graph.addDirectedEdge("session:s1", "turn:s1:c1", { relation: "contains" });
	}
	graph.addNode(id, { kind: "BusEvent", bus, type, correlationId: "c1", timestamp, payload, toolCallId });
	graph.addDirectedEdge("turn:s1:c1", id, { relation: "contains" });
}

// Grounded against real, current Alef session data (~/.local/share/alef/sessions), not
// guessed: dialog.message is fully retired there. sense/llm.input is the human turn,
// motor/llm.response is the assistant's final text for that turn, and signal/llm.result
// (not motor -- the old vocabulary's bus) carries intermediate tool-calling rounds.
describe("buildConversationItems — real Alef event vocabulary (sense/llm.input, motor/llm.response, signal/llm.result)", () => {
	it("renders sense/llm.input as a user message", () => {
		const graph = new TraceGraph();
		addBusEvent(graph, "event:1", "sense", "llm.input", { text: "hello", sender: "human" }, 1000);
		const items = buildConversationItems(graph);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: "message", role: "user", text: "hello" });
	});

	it("renders motor/llm.response as an assistant message", () => {
		const graph = new TraceGraph();
		addBusEvent(graph, "event:1", "motor", "llm.response", { text: "hi there" }, 1000);
		const items = buildConversationItems(graph);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: "message", role: "assistant", text: "hi there" });
	});

	it("renders signal/llm.result with a non-empty toolCalls array as a collapsed turn-marker", () => {
		const graph = new TraceGraph();
		addBusEvent(graph, "event:1", "signal", "llm.result", { toolCalls: [{ name: "fs.read" }, { name: "fs.grep" }] }, 1000);
		const items = buildConversationItems(graph);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: "turn-marker", toolCallCount: 2 });
	});

	it("renders nothing for signal/llm.result with no tool calls -- its text duplicates the eventual llm.response", () => {
		const graph = new TraceGraph();
		addBusEvent(graph, "event:1", "signal", "llm.result", { response: { content: [{ type: "text", text: "partial" }] } }, 1000);
		const items = buildConversationItems(graph);
		expect(items).toHaveLength(0);
	});

	it("still recognizes the legacy motor/llm.result vocabulary (bus fix widens, does not replace)", () => {
		const graph = new TraceGraph();
		addBusEvent(graph, "event:1", "motor", "llm.result", { toolCalls: [{ name: "fs.read" }] }, 1000);
		const items = buildConversationItems(graph);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: "turn-marker", toolCallCount: 1 });
	});

	it("a real multi-round turn: user input, an intermediate tool round, a paired tool call, then the final response", () => {
		const graph = new TraceGraph();
		addBusEvent(graph, "event:1", "sense", "llm.input", { text: "read the readme", sender: "human" }, 1000);
		addBusEvent(graph, "event:2", "signal", "llm.result", { toolCalls: [{ name: "fs.read" }] }, 1001);
		addBusEvent(graph, "event:3", "motor", "fs.read", { path: "readme.md" }, 1002, "tc-1");
		addBusEvent(graph, "event:4", "sense", "fs.read", { content: "# hi" }, 1003, "tc-1");
		addBusEvent(graph, "event:5", "motor", "llm.response", { text: "the readme says hi" }, 1004);
		const items = buildConversationItems(graph);
		expect(items.map((item) => item.kind)).toEqual(["message", "turn-marker", "tool-call", "message"]);
		expect(items[0]).toMatchObject({ role: "user", text: "read the readme" });
		expect(items[3]).toMatchObject({ role: "assistant", text: "the readme says hi" });
	});
});

// Grounded against a real 232MB session file: only 5 of 187 correlationIds carried any
// human/assistant message at all -- the other 182 were pure internal orchestration
// (window.assembled, organ.loaded, context.assemble, agent.run ticks). Without
// suppressing these, buildConversationItems would flood the transcript with tens of
// thousands of fallback items per real session instead of producing a readable one.
describe("buildConversationItems — suppresses high-volume non-conversational noise", () => {
	it.each([
		["debug", "llm:http:start"],
		["debug", "tool:schema-rejected"],
		["internal", "window.assembled"],
		["signal", "llm.chunk"],
		["signal", "llm.tool-chunk"],
		["signal", "llm.thinking"],
		["signal", "llm.checkpoint"],
		["signal", "llm.token-usage"],
		["signal", "llm.tool-stall"],
		["signal", "llm.tool-validation-error"],
		["signal", "llm.tool-start"],
		["signal", "llm.tool-end"],
		["sense", "agent.run"],
		["motor", "agent.run"],
		["signal", "agent.run.inner"],
		["sense", "context.assemble"],
		["motor", "context.assemble"],
		["sense", "organ.loaded"],
		["signal", "plan.tree"],
	])("produces no item for %s/%s", (bus, type) => {
		const graph = new TraceGraph();
		addBusEvent(graph, "event:1", bus, type, { anything: "here" }, 1000);
		const items = buildConversationItems(graph);
		expect(items).toHaveLength(0);
	});

	it("still falls back (does not suppress) a genuinely unrecognized, non-noise type", () => {
		const graph = new TraceGraph();
		addBusEvent(graph, "event:1", "signal", "some.unrecognized.thing", { anything: "goes here" }, 1000);
		const items = buildConversationItems(graph);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ kind: "fallback", bus: "signal", type: "some.unrecognized.thing" });
	});
});

describe("buildConversationItems — unrecognized event types", () => {
	it("falls back to a generic item instead of crashing on an unknown bus/type", () => {
		const graph = new TraceGraph();
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

describe("latestToolCallName", () => {
	function toolCall(toolName: string): ConversationItem {
		return { kind: "tool-call", toolCallId: "1", toolName, request: undefined, response: undefined, timestamp: 0 };
	}
	function message(): ConversationItem {
		return { kind: "message", role: "user", text: "hi", timestamp: 0 };
	}

	it("is undefined for an empty or tool-call-free item list", () => {
		expect(latestToolCallName([])).toBeUndefined();
		expect(latestToolCallName([message()])).toBeUndefined();
	});

	it("returns the most recent tool call's name, not the first", () => {
		expect(latestToolCallName([toolCall("read"), message(), toolCall("bash")])).toBe("bash");
	});
});
