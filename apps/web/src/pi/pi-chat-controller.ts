import { extractMessageText, type PiRpcEvent } from "@danypops/pi-rpc-protocol";
import type { ConversationItem } from "../conversation/projector.js";
import type { PiClient } from "./client.js";

export interface PiChatSnapshot {
	readonly items: readonly ConversationItem[];
	readonly busy: boolean;
	readonly error: string | undefined;
	readonly hasStarted: boolean;
}

export interface PiChatController {
	getSnapshot: () => PiChatSnapshot;
	subscribe: (listener: () => void) => () => void;
	sendMessage: (text: string) => void;
	dispose: () => void;
}

export interface PiChatControllerOptions {
	/** Bound to this controller's own session at creation -- see PiClientCreateSessionOptions. */
	readonly cwd?: string;
}

function describeError(error: unknown): string {
	return error instanceof Error ? `Pi is unavailable (${error.message}).` : "Pi is unavailable.";
}

type ToolCallItem = Extract<ConversationItem, { kind: "tool-call" }>;

/**
 * The same live-Pi-session projection `usePiChat` owns, factored out as a
 * plain (non-hook) controller so `usePiChatSessions` can run any number of
 * them side by side. React's rules of hooks forbid calling a hook once per
 * dynamic key, so a single-session hook can't itself be the building block
 * for a multi-session one -- this is deliberately a small, self-contained
 * duplicate of usePiChat's event-projection logic rather than a shared
 * import; consolidating the two into one shared reducer is a reasonable
 * follow-up once a second caller actually needs it, not before.
 */
export function createPiChatController(client: PiClient, options: PiChatControllerOptions = {}): PiChatController {
	let items: ConversationItem[] = [];
	let busy = false;
	let error: string | undefined;
	let hasStarted = false;
	let sessionPromise: Promise<string> | undefined;
	let unsubscribeEvents: (() => void) | undefined;
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

	function handleEvent(event: PiRpcEvent): void {
		switch (event.type) {
			case "agent_start":
				busy = true;
				notify();
				return;
			case "agent_settled":
				busy = false;
				assistantTimestamp = undefined;
				notify();
				return;
			case "agent_end":
				return;
			case "response":
				if (!event.success) {
					error = event.error ?? "Pi rejected the last message.";
					notify();
				}
				return;
			case "message_start":
			case "message_end":
				if (event.message.role === "user") return;
				if (event.type === "message_end") {
					appendOrReplaceAssistantText(extractMessageText(event.message));
					notify();
				}
				return;
			case "message_update":
				if (event.delta) {
					appendOrReplaceAssistantText(event.delta.text);
					notify();
				}
				return;
			case "tool_execution_start": {
				const item: ToolCallItem = { kind: "tool-call", toolCallId: event.toolCallId, toolName: event.toolName, request: event.args, response: undefined, timestamp: Date.now() };
				toolCallIndex.set(event.toolCallId, items.length);
				items = [...items, item];
				notify();
				return;
			}
			case "tool_execution_end": {
				const index = toolCallIndex.get(event.toolCallId);
				if (index === undefined) return;
				const existing = items[index];
				if (existing?.kind !== "tool-call") return;
				const next = [...items];
				next[index] = { ...existing, response: event.result };
				items = next;
				notify();
				return;
			}
			case "unknown-event":
				return;
		}
	}

	function ensureSession(): Promise<string> {
		sessionPromise ??= client.createSession({ cwd: options.cwd }).then((sessionId) => {
			// A dispose() that raced this session's own creation still must not
			// leave a dangling event subscription behind it.
			if (disposed) return sessionId;
			unsubscribeEvents = client.streamEvents(sessionId, handleEvent, () => {
				error = "Lost connection to Pi.";
				notify();
			});
			return sessionId;
		});
		return sessionPromise;
	}

	return {
		getSnapshot() {
			return { items, busy, error, hasStarted };
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
		dispose() {
			disposed = true;
			unsubscribeEvents?.();
			listeners.clear();
		},
	};
}
