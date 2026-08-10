import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { contentText } from "@earendil-works/pi-ai";
import type { AgentIntegrationPort, AlignmentAgentEvent } from "./agent-integration-port.js";

/**
 * The "proper" adapter story 8 asks for: wraps a real, already-constructed
 * `AgentSession` (from `@earendil-works/pi-coding-agent`'s public SDK --
 * `createAgentSession()`) in the same process, translating its own
 * AgentSessionEvent family down to Alignment's bounded AlignmentAgentEvent.
 * Construction (createAgentSession, ModelRuntime, ResourceLoader, ...) is
 * deliberately left to the caller -- this adapter's only job is wrapping an
 * already-live session, not owning its setup policy.
 */
export function createInProcessAgentIntegration(session: AgentSession): AgentIntegrationPort {
	const eventListeners = new Set<(event: AlignmentAgentEvent) => void>();
	let unsubscribeSession: (() => void) | undefined;

	function emit(event: AlignmentAgentEvent): void {
		for (const listener of eventListeners) listener(event);
	}

	/**
	 * Translates one AgentSessionEvent into zero or one AlignmentAgentEvent.
	 * Exhaustive over AgentSessionEvent's own variants (a new one added
	 * upstream fails this file's typecheck via assertNeverAgentSessionEvent)
	 * even though most map to nothing -- Alignment's bounded event type has
	 * no use for compaction/retry/queue/session-tree internals. Only the
	 * "text_delta" sub-kind of message_update is handled; other
	 * assistantMessageEvent sub-kinds (thinking, tool-call deltas, ...) are
	 * intentionally out of scope for this slice -- see the task body.
	 */
	function translate(event: AgentSessionEvent): AlignmentAgentEvent | undefined {
		switch (event.type) {
			case "agent_start":
				return { type: "agent-start" };
			case "agent_settled":
				return { type: "agent-settled" };
			case "agent_end":
				return undefined;
			case "message_start":
				return event.message.role === "assistant" ? { type: "assistant-message-start" } : undefined;
			case "message_update":
				if (event.assistantMessageEvent.type !== "text_delta") return undefined;
				return { type: "assistant-message-delta", text: event.assistantMessageEvent.delta };
			case "message_end":
				return event.message.role === "assistant" ? { type: "assistant-message-end", text: contentText(event.message.content, "") } : undefined;
			case "tool_execution_start":
				return { type: "tool-call-start", toolCallId: event.toolCallId, toolName: event.toolName, input: event.args };
			case "tool_execution_end":
				return { type: "tool-call-end", toolCallId: event.toolCallId, toolName: event.toolName, output: event.result, isError: event.isError };
			case "tool_execution_update":
			case "turn_start":
			case "turn_end":
			case "queue_update":
			case "compaction_start":
			case "compaction_end":
			case "entry_appended":
			case "session_info_changed":
			case "thinking_level_changed":
			case "auto_retry_start":
			case "auto_retry_end":
			case "summarization_retry_scheduled":
			case "summarization_retry_attempt_start":
			case "summarization_retry_finished":
			case "bash_execution_update":
				return undefined;
			default:
				return assertNeverAgentSessionEvent(event);
		}
	}

	unsubscribeSession = session.subscribe((event) => {
		const translated = translate(event);
		if (translated) emit(translated);
	});

	return {
		/** A convenience over AgentSession.prompt(): auto-selects "steer" while the agent is already streaming, instead of requiring every caller to branch on session.isStreaming itself. Use steer()/followUp() directly for explicit control over queueing. */
		async prompt(text) {
			await session.prompt(text, session.isStreaming ? { streamingBehavior: "steer" } : undefined);
		},
		async steer(text) {
			await session.steer(text);
		},
		async followUp(text) {
			await session.followUp(text);
		},
		async abort() {
			await session.abort();
		},
		onEvent(listener) {
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
		},
		onExit() {
			// The in-process adapter has no separate process to exit -- dispose()
			// is always caller-initiated, never an unexpected termination.
			return () => {};
		},
		dispose() {
			unsubscribeSession?.();
			eventListeners.clear();
			session.dispose();
		},
	};
}

function assertNeverAgentSessionEvent(event: never): AlignmentAgentEvent | undefined {
	throw new Error(`Unhandled AgentSessionEvent: ${JSON.stringify(event)}`);
}
