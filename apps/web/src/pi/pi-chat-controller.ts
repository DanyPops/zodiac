import type { AgentSessionControlOutcome, ZodiacAgentEvent } from "@zodiac/agent";
import type { ConversationItem } from "../conversation/projector.js";
import type { PiClient } from "./client.js";

export interface PiChatSnapshot {
	readonly items: readonly ConversationItem[];
	readonly busy: boolean;
	readonly error: string | undefined;
	readonly hasStarted: boolean;
	readonly activity: "turn" | "compaction" | undefined;
	readonly sessionName: string | undefined;
}

export interface PiChatController {
	getSnapshot: () => PiChatSnapshot;
	subscribe: (listener: () => void) => () => void;
	sendMessage: (text: string) => void;
	setModel: (provider: string, modelId: string) => Promise<AgentSessionControlOutcome>;
	compact: (customInstructions?: string) => Promise<AgentSessionControlOutcome>;
	resume: (sessionPath: string) => Promise<AgentSessionControlOutcome>;
	fork: (entryId: string) => Promise<AgentSessionControlOutcome>;
	dispose: () => void;
}

export interface PiChatControllerOptions {
	/** Bound to this controller's own session at creation -- see PiClientCreateSessionOptions. */
	readonly cwd?: string;
	/**
	 * Fired for every real tool-call-start event this controller observes,
	 * generic and Zodiac-domain-agnostic on purpose (this controller itself
	 * carries no visual-cue-specific -- or any other tool-specific -- logic).
	 * The actual reason this exists: a Client-side handler for a tool like
	 * list_visual_cues (see createVisualCueClientActionHandler) needs to
	 * observe the exact same tool-call-start events this controller already
	 * receives, without opening a second SSE connection to the same session
	 * just to get them (a real, avoidable cost -- see the SSE
	 * backpressure/connection-budget audit task).
	 */
	readonly onToolCall?: (event: { sessionId: string; toolCallId: string; toolName: string; input: unknown }) => void;
}

function describeError(error: unknown): string {
	return error instanceof Error ? `Pi is unavailable (${error.message}).` : "Pi is unavailable.";
}

type ToolCallItem = Extract<ConversationItem, { kind: "tool-call" }>;

/**
 * Owns one live agent-session projection, driven by zodiacd's own bounded
 * ZodiacAgentEvent vocabulary (zodiacd stage 4 -- previously the raw
 * PiRpcEvent wire shape of a locally-spawned `pi --mode rpc` subprocess).
 * Factored out as a plain (non-hook) controller so usePiChatSessions can
 * run any number of them side by side -- React's rules of hooks forbid
 * calling a hook once per dynamic key.
 */
export function createPiChatController(client: PiClient, options: PiChatControllerOptions = {}): PiChatController {
	let items: ConversationItem[] = [];
	let busy = false;
	let error: string | undefined;
	let hasStarted = false;
	let activity: "turn" | "compaction" | undefined;
	let sessionName: string | undefined;
	let sessionPromise: Promise<string> | undefined;
	let unsubscribeEvents: (() => void) | undefined;
	// Set once ensureSession()'s own session-creation Promise resolves --
	// tool-call-start events only ever start arriving after that point (they
	// flow through client.streamEvents(sessionId, ...), subscribed there),
	// so this is always defined by the time handleEvent's own "tool-call-start"
	// case below could possibly run.
	let currentSessionId: string | undefined;
	let assistantTimestamp: number | undefined;
	let disposed = false;
	const toolCallIndex = new Map<string, number>();
	const listeners = new Set<() => void>();

	function notify(): void {
		for (const listener of listeners) listener();
	}

	function appendOrReplaceAssistantText(text: string): void {
		const last = items[items.length - 1];
		if (assistantTimestamp !== undefined && last?.kind === "message" && last.role === "assistant" && last.timestamp === assistantTimestamp) {
			items = [...items.slice(0, -1), { ...last, text }];
			return;
		}
		const nextTimestamp = assistantTimestamp ?? Date.now();
		assistantTimestamp = nextTimestamp;
		items = [...items, { kind: "message", role: "assistant", text, timestamp: nextTimestamp }];
	}

	function handleStatusEvent(event: ZodiacAgentEvent): boolean {
		switch (event.type) {
			case "agent-start":
				busy = true;
				break;
			case "agent-settled":
				busy = false;
				activity = undefined;
				assistantTimestamp = undefined;
				break;
			case "turn-start":
				activity = "turn";
				break;
			case "turn-end":
				if (activity === "turn") activity = undefined;
				break;
			case "compaction-start":
				activity = "compaction";
				busy = true;
				break;
			case "compaction-end":
				if (activity === "compaction") activity = undefined;
				if (event.errorMessage) error = event.errorMessage;
				break;
			case "session-info-changed":
				sessionName = event.name;
				break;
			case "error":
				error = event.message;
				busy = false;
				break;
			default:
				return false;
		}
		notify();
		return true;
	}

	function updateToolCall(toolCallId: string, output: unknown): void {
		const index = toolCallIndex.get(toolCallId);
		if (index === undefined) return;
		const existing = items[index];
		if (existing?.kind !== "tool-call") return;
		const next = [...items];
		next[index] = { ...existing, response: output };
		items = next;
		notify();
	}

	function handleEvent(event: ZodiacAgentEvent): void {
		if (handleStatusEvent(event)) return;
		switch (event.type) {
			case "assistant-message-start":
				// A fresh assistant message begins -- ensure the next delta/end
				// starts its own ConversationItem rather than reusing a stale
				// timestamp left over from an earlier message this same turn.
				assistantTimestamp = undefined;
				return;
			// Both carry event.text as the full text so far -- assistant-message-delta's
			// is already the full accumulated text (see InProcessAgentIntegration's own
			// doc comment on why it builds this itself rather than trusting an SDK-owned
			// snapshot), and assistant-message-end's is the final text -- replace, not
			// append, either way.
			case "assistant-message-delta":
			case "assistant-message-end":
				appendOrReplaceAssistantText(event.text);
				notify();
				return;
			case "tool-call-start": {
				const item: ToolCallItem = { kind: "tool-call", toolCallId: event.toolCallId, toolName: event.toolName, request: event.input, response: undefined, timestamp: Date.now() };
				toolCallIndex.set(event.toolCallId, items.length);
				items = [...items, item];
				if (currentSessionId) options.onToolCall?.({ sessionId: currentSessionId, toolCallId: event.toolCallId, toolName: event.toolName, input: event.input });
				notify();
				return;
			}
			case "tool-call-update":
			case "tool-call-end":
				updateToolCall(event.toolCallId, event.output);
				return;
			default:
				return;
		}
	}

	function ensureSession(): Promise<string> {
		sessionPromise ??= client.createSession({ cwd: options.cwd }).then((sessionId) => {
			// A dispose() that raced this session's own creation still must not
			// leave a dangling event subscription behind it.
			if (disposed) return sessionId;
			currentSessionId = sessionId;
			unsubscribeEvents = client.streamEvents(sessionId, handleEvent, () => {
				error = "Lost connection to Pi.";
				notify();
			});
			return sessionId;
		});
		return sessionPromise;
	}

	const unsupportedControl = (name: string): AgentSessionControlOutcome => ({ ok: false, reason: "unsupported", message: `The Web Pi client does not support ${name}.` });

	return {
		getSnapshot() {
			return { items, busy, error, hasStarted, activity, sessionName };
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		sendMessage(text) {
			const trimmed = text.trim();
			if (!trimmed) return;
			hasStarted = true;
			error = undefined;
			items = [...items, { kind: "message", role: "user", text: trimmed, timestamp: Date.now() }];
			notify();
			ensureSession()
				.then((sessionId) => client.sendPrompt(sessionId, trimmed))
				.catch((sendError: unknown) => {
					error = describeError(sendError);
					notify();
				});
		},
		async setModel(provider, modelId) {
			const sessionId = await ensureSession();
			return client.setModel?.(sessionId, provider, modelId) ?? unsupportedControl("model switching");
		},
		async compact(customInstructions) {
			const sessionId = await ensureSession();
			return client.compact?.(sessionId, customInstructions) ?? unsupportedControl("manual compaction");
		},
		async resume(sessionPath) {
			const sessionId = await ensureSession();
			return client.resume?.(sessionId, sessionPath) ?? unsupportedControl("session resume");
		},
		async fork(entryId) {
			const sessionId = await ensureSession();
			return client.fork?.(sessionId, entryId) ?? unsupportedControl("session fork");
		},
		dispose() {
			disposed = true;
			unsubscribeEvents?.();
			listeners.clear();
		},
	};
}
