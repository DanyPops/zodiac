/**
 * The subset of Pi's documented RPC protocol (docs/rpc.md in pi-mono) that
 * Alignment actually drives today: sending a prompt/abort command, and
 * parsing the event types needed to render a live conversation (message
 * text, streaming deltas, tool-call start/end, and run lifecycle). Every
 * other real event type (compaction, retries, extension_ui_request, ...)
 * parses into `unknown-event` rather than being dropped or throwing --
 * forward-compatible with the rest of the protocol this file doesn't model
 * yet, matching the ingest layer's existing "skip, don't crash" discipline.
 */

export interface PiPromptCommand {
	readonly type: "prompt";
	readonly message: string;
}

export interface PiAbortCommand {
	readonly type: "abort";
}

export type PiRpcCommand = PiPromptCommand | PiAbortCommand;

export function encodeRpcCommand(command: PiRpcCommand): string {
	return `${JSON.stringify(command)}\n`;
}

export interface PiRpcMessage {
	readonly role: string;
	readonly content: unknown;
}

export type PiRpcEvent =
	| { readonly type: "response"; readonly command: string; readonly success: boolean; readonly error?: string }
	| { readonly type: "agent_start" }
	| { readonly type: "agent_end" }
	| { readonly type: "agent_settled" }
	| { readonly type: "message_start"; readonly message: PiRpcMessage }
	| { readonly type: "message_end"; readonly message: PiRpcMessage }
	| { readonly type: "message_update"; readonly delta: PiTextDelta | undefined }
	| { readonly type: "tool_execution_start"; readonly toolCallId: string; readonly toolName: string; readonly args: unknown }
	| { readonly type: "tool_execution_end"; readonly toolCallId: string; readonly toolName: string; readonly result: unknown; readonly isError: boolean }
	| { readonly type: "unknown-event"; readonly raw: unknown };

export interface PiTextDelta {
	readonly text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseMessage(value: unknown): PiRpcMessage | undefined {
	if (!isRecord(value) || typeof value.role !== "string") return undefined;
	return { role: value.role, content: value.content };
}

/** Extracts the accumulated text from `message_update`'s `assistantMessageEvent.partial`, when it carries one. */
function parseTextDelta(assistantMessageEvent: unknown): PiTextDelta | undefined {
	if (!isRecord(assistantMessageEvent)) return undefined;
	const partial = assistantMessageEvent.partial;
	if (!isRecord(partial)) return undefined;
	return { text: extractMessageText(partial) };
}

/**
 * Pulls plain text out of an AgentMessage's `content`, which is either a
 * bare string (UserMessage) or an array of typed content blocks
 * (AssistantMessage's text/thinking/toolCall blocks) -- collects only the
 * `text` blocks, since thinking and tool-call blocks render as their own
 * distinct conversation items elsewhere.
 */
export function extractMessageText(message: unknown): string {
	if (!isRecord(message)) return "";
	const { content } = message;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: string; text: string } => isRecord(block) && block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("");
}

function parseToolExecutionStart(value: Record<string, unknown>): PiRpcEvent | undefined {
	if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string") return undefined;
	return { type: "tool_execution_start", toolCallId: value.toolCallId, toolName: value.toolName, args: value.args };
}

function parseToolExecutionEnd(value: Record<string, unknown>): PiRpcEvent | undefined {
	if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string") return undefined;
	return { type: "tool_execution_end", toolCallId: value.toolCallId, toolName: value.toolName, result: value.result, isError: value.isError === true };
}

function parseResponse(value: Record<string, unknown>): PiRpcEvent | undefined {
	if (typeof value.command !== "string" || typeof value.success !== "boolean") return undefined;
	return { type: "response", command: value.command, success: value.success, error: typeof value.error === "string" ? value.error : undefined };
}

/** Parses one JSONL line from Pi's RPC stdout into a typed event; never throws -- a malformed or unrecognized line degrades to `unknown-event` (or is skipped entirely on unparseable JSON). */
export function parseRpcLine(line: string): PiRpcEvent | undefined {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (!isRecord(value) || typeof value.type !== "string") return undefined;

	switch (value.type) {
		case "agent_start":
		case "agent_end":
		case "agent_settled":
			return { type: value.type };
		case "response":
			return parseResponse(value) ?? { type: "unknown-event", raw: value };
		case "message_start":
		case "message_end": {
			const message = parseMessage(value.message);
			return message ? { type: value.type, message } : { type: "unknown-event", raw: value };
		}
		case "message_update":
			return { type: "message_update", delta: parseTextDelta(value.assistantMessageEvent) };
		case "tool_execution_start":
			return parseToolExecutionStart(value) ?? { type: "unknown-event", raw: value };
		case "tool_execution_end":
			return parseToolExecutionEnd(value) ?? { type: "unknown-event", raw: value };
		default:
			return { type: "unknown-event", raw: value };
	}
}
