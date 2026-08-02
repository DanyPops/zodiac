import { describe, expect, it } from "vitest";
import { encodeRpcCommand, extractMessageText, parseRpcLine } from "./rpc-protocol.js";

describe("encodeRpcCommand", () => {
	it("encodes a prompt command as one LF-terminated JSON line", () => {
		expect(encodeRpcCommand({ type: "prompt", message: "hello" })).toBe('{"type":"prompt","message":"hello"}\n');
	});

	it("encodes an abort command", () => {
		expect(encodeRpcCommand({ type: "abort" })).toBe('{"type":"abort"}\n');
	});
});

describe("parseRpcLine", () => {
	it("skips unparseable JSON", () => {
		expect(parseRpcLine("not json")).toBeUndefined();
	});

	it("skips a JSON value with no string type field", () => {
		expect(parseRpcLine("{}")).toBeUndefined();
		expect(parseRpcLine('{"type":1}')).toBeUndefined();
	});

	it("parses lifecycle events with no payload", () => {
		expect(parseRpcLine('{"type":"agent_start"}')).toEqual({ type: "agent_start" });
		expect(parseRpcLine('{"type":"agent_end"}')).toEqual({ type: "agent_end" });
		expect(parseRpcLine('{"type":"agent_settled"}')).toEqual({ type: "agent_settled" });
	});

	it("parses a successful response", () => {
		expect(parseRpcLine('{"type":"response","command":"prompt","success":true}')).toEqual({ type: "response", command: "prompt", success: true, error: undefined });
	});

	it("parses a failed response with its error message", () => {
		expect(parseRpcLine('{"type":"response","command":"prompt","success":false,"error":"boom"}')).toEqual({
			type: "response",
			command: "prompt",
			success: false,
			error: "boom",
		});
	});

	it("degrades a malformed response to unknown-event", () => {
		const raw = { type: "response", command: "prompt" };
		expect(parseRpcLine(JSON.stringify(raw))).toEqual({ type: "unknown-event", raw });
	});

	it("parses message_start/message_end with a string content user message", () => {
		const line = '{"type":"message_start","message":{"role":"user","content":"hi"}}';
		expect(parseRpcLine(line)).toEqual({ type: "message_start", message: { role: "user", content: "hi" } });
	});

	it("parses message_end with an assistant text content block array", () => {
		const line = '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"pong"}]}}';
		const event = parseRpcLine(line);
		expect(event?.type).toBe("message_end");
		if (event?.type === "message_end") expect(extractMessageText(event.message)).toBe("pong");
	});

	it("degrades message_start with no message field to unknown-event", () => {
		const raw = { type: "message_start" };
		expect(parseRpcLine(JSON.stringify(raw))).toEqual({ type: "unknown-event", raw });
	});

	it("parses message_update's accumulated partial text", () => {
		const line = '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"lo","partial":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}}';
		expect(parseRpcLine(line)).toEqual({ type: "message_update", delta: { text: "hello" } });
	});

	it("parses message_update with no partial as an empty delta", () => {
		expect(parseRpcLine('{"type":"message_update","assistantMessageEvent":{"type":"start"}}')).toEqual({ type: "message_update", delta: undefined });
	});

	it("parses tool_execution_start/end", () => {
		const start = '{"type":"tool_execution_start","toolCallId":"call_1","toolName":"bash","args":{"command":"ls"}}';
		expect(parseRpcLine(start)).toEqual({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "ls" } });

		const end = '{"type":"tool_execution_end","toolCallId":"call_1","toolName":"bash","result":{"ok":true},"isError":false}';
		expect(parseRpcLine(end)).toEqual({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", result: { ok: true }, isError: false });
	});

	it("degrades a tool execution event missing required fields to unknown-event", () => {
		const raw = { type: "tool_execution_start", toolCallId: "call_1" };
		expect(parseRpcLine(JSON.stringify(raw))).toEqual({ type: "unknown-event", raw });
	});

	it("degrades any other real event type to unknown-event instead of dropping it", () => {
		const raw = { type: "compaction_start", reason: "threshold" };
		expect(parseRpcLine(JSON.stringify(raw))).toEqual({ type: "unknown-event", raw });
	});
});

describe("extractMessageText", () => {
	it("returns a string content verbatim", () => {
		expect(extractMessageText({ role: "user", content: "hi" })).toBe("hi");
	});

	it("joins only text blocks from a content array, skipping thinking/toolCall blocks", () => {
		const message = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "..." },
				{ type: "text", text: "Hello " },
				{ type: "toolCall", id: "call_1", name: "bash", arguments: {} },
				{ type: "text", text: "world" },
			],
		};
		expect(extractMessageText(message)).toBe("Hello world");
	});

	it("returns an empty string for a non-record or missing content", () => {
		expect(extractMessageText(undefined)).toBe("");
		expect(extractMessageText({ role: "user" })).toBe("");
	});
});
