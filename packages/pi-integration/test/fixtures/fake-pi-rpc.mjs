#!/usr/bin/env node
// A minimal stand-in for `pi --mode rpc`, driven by the same LF-delimited
// JSONL framing as the real protocol (docs/rpc.md). Mirrors
// apps/alignment/test/fixtures/fake-pi-rpc.mjs -- kept as its own copy here
// since this package must stay independently testable without depending on
// a sibling app's test fixtures.

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let index;
	while ((index = buffer.indexOf("\n")) !== -1) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		if (line.trim()) handleLine(line);
	}
});
process.stdin.on("end", () => process.exit(0));

function emit(event) {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

function handleLine(line) {
	const command = JSON.parse(line);
	if (command.type === "prompt") {
		emit({ type: "response", command: "prompt", success: true });
		emit({ type: "message_start", message: { role: "user", content: command.message } });
		emit({ type: "message_end", message: { role: "user", content: command.message } });
		emit({ type: "agent_start" });
		emit({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "echo hi" } });
		emit({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", result: { output: "hi\n" }, isError: false });
		emit({ type: "message_start", message: { role: "assistant", content: [] } });
		emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", partial: { role: "assistant", content: [{ type: "text", text: "fake " }] } } });
		emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", partial: { role: "assistant", content: [{ type: "text", text: "fake reply" }] } } });
		emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "fake reply" }] } });
		emit({ type: "agent_end" });
		emit({ type: "agent_settled" });
	} else if (command.type === "abort") {
		emit({ type: "response", command: "abort", success: true });
	}
}
