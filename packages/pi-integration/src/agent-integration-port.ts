/**
 * Alignment's own bounded vocabulary for a live Pi conversation -- what a
 * renderer (Web's Footer chat, the TUI's Footer region, a future test) needs
 * to project a conversation, deliberately smaller than Pi's own internal
 * AgentSessionEvent family (agent_start, message_start/update/end,
 * turn_start/end, tool_execution_start/update/end, compaction_*,
 * auto_retry_*, queue_update, entry_appended, session_info_changed,
 * thinking_level_changed, summarization_retry_*, bash_execution_update --
 * ~20 variants). Both InProcessAgentIntegration and SubprocessAgentIntegration
 * translate down to this same, smaller type so a caller never has to know
 * which adapter is live behind the port.
 */
export type AlignmentAgentEvent =
	| { readonly type: "agent-start" }
	| { readonly type: "agent-settled" }
	| { readonly type: "assistant-message-start" }
	/** A streaming text delta for the in-progress assistant message. */
	| { readonly type: "assistant-message-delta"; readonly text: string }
	/** The assistant message's final, complete text. */
	| { readonly type: "assistant-message-end"; readonly text: string }
	| { readonly type: "tool-call-start"; readonly toolCallId: string; readonly toolName: string; readonly input: unknown }
	| { readonly type: "tool-call-end"; readonly toolCallId: string; readonly toolName: string; readonly output: unknown; readonly isError: boolean }
	| { readonly type: "error"; readonly message: string };

/**
 * The driven half of a Pi Agent Integration: what Alignment needs to send a
 * prompt to a live agent and observe its conversation, independent of
 * whether that agent lives in-process (InProcessAgentIntegration) or as a
 * subprocess speaking pi's RPC protocol (SubprocessAgentIntegration). Both
 * adapters implement this exact shape -- a caller depends on this interface,
 * never on either concrete adapter.
 *
 * Deliberately excludes the driving half (Pi's own tools calling back into
 * Alignment through an authorized command port) -- that half depends on
 * Walking skeleton story 7's caller-parity work and is out of scope here.
 */
export interface AgentIntegrationPort {
	/** Sends a prompt. Rejects if the agent is already streaming and a queued alternative (steer/followUp) is more appropriate. */
	prompt: (text: string) => Promise<void>;
	/** Queues a message for delivery after the current assistant turn's tool calls finish, ahead of the next LLM call. */
	steer: (text: string) => Promise<void>;
	/** Queues a message for delivery only once the agent has fully settled. */
	followUp: (text: string) => Promise<void>;
	/** Aborts the current run, if any. */
	abort: () => Promise<void>;
	onEvent: (listener: (event: AlignmentAgentEvent) => void) => () => void;
	/** Fires once if the underlying integration ends unexpectedly (a subprocess exiting; never fires for the in-process adapter, which has no separate process to exit). */
	onExit: (listener: (reason: string | undefined) => void) => () => void;
	dispose: () => void;
}

/** Exhaustiveness guard for callers translating a value this package doesn't already recognize -- never actually reachable at runtime for a well-typed caller. */
export function assertNeverAlignmentAgentEvent(event: never): never {
	throw new Error(`Unhandled AlignmentAgentEvent: ${JSON.stringify(event)}`);
}
