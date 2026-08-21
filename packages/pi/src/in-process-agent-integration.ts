import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { contentText } from "@earendil-works/pi-ai";
import type { AgentIntegrationPort, AgentSessionControlOutcome, ZodiacAgentEvent } from "@zodiac/agent";

export interface InProcessAgentIntegrationOptions {
	readonly resolveModel?: (provider: string, modelId: string) => Parameters<AgentSession["setModel"]>[0] | undefined;
	readonly resume?: (sessionPath: string) => Promise<AgentSessionControlOutcome>;
	readonly fork?: (entryId: string) => Promise<AgentSessionControlOutcome>;
}

/**
 * The "proper" adapter story 8 asks for: wraps a real, already-constructed
 * `AgentSession` (from `@earendil-works/pi-coding-agent`'s public SDK --
 * `createAgentSession()`) in the same process, translating its own
 * AgentSessionEvent family down to Zodiac's bounded ZodiacAgentEvent.
 * Construction (createAgentSession, ModelRuntime, ResourceLoader, ...) is
 * deliberately left to the caller -- this adapter's only job is wrapping an
 * already-live session, not owning its setup policy.
 */
export function createInProcessAgentIntegration(session: AgentSession, options: InProcessAgentIntegrationOptions = {}): AgentIntegrationPort {
	const eventListeners = new Set<(event: ZodiacAgentEvent) => void>();
	let unsubscribeSession: (() => void) | undefined;
	/**
	 * Accumulated text of the assistant message currently streaming, reset on
	 * every message_start. Built ourselves from `assistantMessageEvent.delta`
	 * -- the one genuinely immutable value in this whole event family -- 
	 * rather than trusting any "accumulated" snapshot the SDK itself hands us
	 * (`event.message` or `assistantMessageEvent.partial`). Confirmed live,
	 * with a hermetic faux-provider reproduction: both of those snapshot
	 * objects are mutated in place by the underlying stream (pi-ai's own
	 * `streamWithDeltas` shallow-clones its wrapper per event but reuses the
	 * same `content` array/block objects throughout), so reading either one
	 * from inside a message_update listener can observe the *final* text
	 * immediately, even on the very first delta -- there is no reliable
	 * point-in-time snapshot to read there at all, only the delta itself.
	 */
	let streamingText = "";

	function emit(event: ZodiacAgentEvent): void {
		for (const listener of eventListeners) listener(event);
	}

	/**
	 * Translates one AgentSessionEvent into zero or one ZodiacAgentEvent.
	 * Exhaustive over AgentSessionEvent's own variants (a new one added
	 * upstream fails this file's typecheck via assertNeverAgentSessionEvent)
	 * even though most map to nothing -- Zodiac's bounded event type has
	 * no use for compaction/retry/queue/session-tree internals. Only the
	 * "text_delta" sub-kind of message_update is handled; other
	 * assistantMessageEvent sub-kinds (thinking, tool-call deltas, ...) are
	 * intentionally out of scope for this slice -- see the task body.
	 */
	function translate(event: AgentSessionEvent): ZodiacAgentEvent | undefined {
		switch (event.type) {
			case "agent_start":
				return { type: "agent-start" };
			case "agent_settled":
				return { type: "agent-settled" };
			case "agent_end":
				return undefined;
			case "message_start":
				if (event.message.role !== "assistant") return undefined;
				streamingText = "";
				return { type: "assistant-message-start" };
			case "message_update":
				// A real reported bug lived here: this used to read an "accumulated"
				// snapshot (either `event.message.content` or
				// `assistantMessageEvent.partial.content`) directly, on the theory
				// that message_update carries the same shape as message_end's own
				// accumulated message ("Fired during assistant message streaming
				// with token-by-token updates", per the SDK's own doc comment).
				// Confirmed live via a hermetic reproduction that both snapshots are
				// unsafe to read progressively -- see streamingText's own doc
				// comment. `delta` alone (a real per-chunk increment,
				// @earendil-works/pi-ai's own text_delta type) is the only value
				// here that's actually safe to trust point-in-time, so this
				// ZodiacAgentEvent's `text` is built by accumulating it
				// ourselves, never by reading a snapshot the SDK owns.
				if (event.assistantMessageEvent.type !== "text_delta") return undefined;
				streamingText += event.assistantMessageEvent.delta;
				return { type: "assistant-message-delta", text: streamingText };
			case "message_end":
				if (event.message.role !== "assistant") return undefined;
				// A real API failure (auth expired, out of credits, rate limited, ...)
				// arrives here as an assistant message_end with empty content and
				// stopReason "error"/"aborted" -- found live: contentText() on empty
				// content silently produces "", which the Footer then rendered as a
				// meaningless "(empty response)" with no indication anything had
				// actually gone wrong. Surface the real errorMessage instead.
				if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
					return { type: "error", message: event.message.errorMessage ?? "The agent stopped unexpectedly." };
				}
				return { type: "assistant-message-end", text: contentText(event.message.content, "") };
			case "turn_start":
				return { type: "turn-start" };
			case "turn_end":
				return { type: "turn-end" };
			case "tool_execution_start":
				return { type: "tool-call-start", toolCallId: event.toolCallId, toolName: event.toolName, input: event.args };
			case "tool_execution_update":
				return { type: "tool-call-update", toolCallId: event.toolCallId, toolName: event.toolName, output: event.partialResult };
			case "tool_execution_end":
				return { type: "tool-call-end", toolCallId: event.toolCallId, toolName: event.toolName, output: event.result, isError: event.isError };
			case "compaction_start":
				return { type: "compaction-start", reason: event.reason };
			case "compaction_end":
				return { type: "compaction-end", reason: event.reason, aborted: event.aborted, ...(event.errorMessage !== undefined ? { errorMessage: event.errorMessage } : {}) };
			case "session_info_changed":
				return { type: "session-info-changed", ...(event.name !== undefined ? { name: event.name } : {}) };
			case "queue_update":
			case "entry_appended":
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
		session: {
			async setModel(provider, modelId) {
				const model = options.resolveModel?.(provider, modelId);
				if (!model) return { ok: false, reason: "model-not-found", message: `Model not found: ${provider}/${modelId}` };
				try {
					await session.setModel(model);
					return { ok: true };
				} catch (error) {
					return { ok: false, reason: "failed", message: error instanceof Error ? error.message : String(error) };
				}
			},
			async compact(customInstructions) {
				try {
					await session.compact(customInstructions);
					return { ok: true };
				} catch (error) {
					return { ok: false, reason: "failed", message: error instanceof Error ? error.message : String(error) };
				}
			},
			async resume(sessionPath) {
				return options.resume?.(sessionPath) ?? { ok: false, reason: "unsupported", message: "This embedded session was not constructed with a replaceable AgentSessionRuntime." };
			},
			async fork(entryId) {
				return options.fork?.(entryId) ?? { ok: false, reason: "unsupported", message: "This embedded session was not constructed with a replaceable AgentSessionRuntime." };
			},
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

function assertNeverAgentSessionEvent(event: never): ZodiacAgentEvent | undefined {
	throw new Error(`Unhandled AgentSessionEvent: ${JSON.stringify(event)}`);
}
