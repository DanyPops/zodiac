import { useEffect, useRef, useState } from "react";
import type { ConversationItem } from "../conversation/projector.js";
import type { PiClient } from "./client.js";
import { extractMessageText, type PiRpcEvent } from "@danypops/pi-rpc-protocol";

export interface PiChat {
	readonly items: readonly ConversationItem[];
	readonly busy: boolean;
	readonly error: string | undefined;
	/** True once the user has sent at least one live message this session -- lets a caller decide whether to show this live conversation or fall back to something else (e.g. a browsed historical one). */
	readonly hasStarted: boolean;
	sendMessage: (text: string) => void;
}

function describeError(error: unknown): string {
	return error instanceof Error ? `Pi is unavailable (${error.message}).` : "Pi is unavailable.";
}

type ToolCallItem = Extract<ConversationItem, { kind: "tool-call" }>;

/**
 * Owns one live Pi RPC session end to end: creates it lazily on the first
 * sent message, streams its events, and projects them into the same
 * ConversationItem shape the (historical, Alef-sourced) conversation
 * projector already produces -- so ConversationSurface/ChatOverlay render
 * either source with no changes of their own.
 *
 * The user's own message is echoed into `items` immediately on send, not
 * only once the server round-trips its own `message_start` for it, since
 * there's exactly one client driving this session and no reason to wait for
 * an echo of what's already known. The real `message_start`/`message_end`
 * events for that same user message are suppressed as a result -- they'd
 * otherwise duplicate the optimistic echo.
 */
export function usePiChat(client: PiClient): PiChat {
	const [items, setItems] = useState<ConversationItem[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [hasStarted, setHasStarted] = useState(false);
	const sessionPromiseRef = useRef<Promise<string>>(undefined);
	const unsubscribeRef = useRef<() => void>(undefined);
	const assistantTimestampRef = useRef<number>(undefined);
	const toolCallIndexRef = useRef(new Map<string, number>());

	useEffect(() => () => unsubscribeRef.current?.(), []);

	function appendOrReplaceAssistantText(text: string): void {
		const timestamp = assistantTimestampRef.current;
		setItems((previous) => {
			const last = previous[previous.length - 1];
			if (timestamp !== undefined && last?.kind === "message" && last.role === "assistant" && last.timestamp === timestamp) {
				return [...previous.slice(0, -1), { ...last, text }];
			}
			const nextTimestamp = timestamp ?? Date.now();
			assistantTimestampRef.current = nextTimestamp;
			return [...previous, { kind: "message", role: "assistant", text, timestamp: nextTimestamp }];
		});
	}

	function handleEvent(event: PiRpcEvent): void {
		switch (event.type) {
			case "agent_start":
				setBusy(true);
				return;
			case "agent_settled":
				setBusy(false);
				assistantTimestampRef.current = undefined;
				return;
			case "agent_end":
				return;
			case "response":
				if (!event.success) setError(event.error ?? "Pi rejected the last message.");
				return;
			case "message_start":
			case "message_end":
				// The user-role echo of what was already shown optimistically on
				// send; assistant text arrives via message_update/message_end below.
				if (event.message.role === "user") return;
				if (event.type === "message_end") appendOrReplaceAssistantText(extractMessageText(event.message));
				return;
			case "message_update":
				if (event.delta) appendOrReplaceAssistantText(event.delta.text);
				return;
			case "tool_execution_start": {
				const item: ToolCallItem = { kind: "tool-call", toolCallId: event.toolCallId, toolName: event.toolName, request: event.args, response: undefined, timestamp: Date.now() };
				setItems((previous) => {
					toolCallIndexRef.current.set(event.toolCallId, previous.length);
					return [...previous, item];
				});
				return;
			}
			case "tool_execution_end": {
				const index = toolCallIndexRef.current.get(event.toolCallId);
				if (index === undefined) return;
				setItems((previous) => {
					const existing = previous[index];
					if (existing?.kind !== "tool-call") return previous;
					const next = [...previous];
					next[index] = { ...existing, response: event.result };
					return next;
				});
				return;
			}
			case "unknown-event":
				return;
		}
	}

	function ensureSession(): Promise<string> {
		sessionPromiseRef.current ??= client.createSession().then((sessionId) => {
			unsubscribeRef.current = client.streamEvents(sessionId, handleEvent, () => setError("Lost connection to Pi."));
			return sessionId;
		});
		return sessionPromiseRef.current;
	}

	return {
		items,
		busy,
		error,
		hasStarted,
		sendMessage(text) {
			const trimmed = text.trim();
			if (!trimmed) return;
			setHasStarted(true);
			setError(undefined);
			setItems((previous) => [...previous, { kind: "message", role: "user", text: trimmed, timestamp: Date.now() }]);
			ensureSession()
				.then((sessionId) => client.sendPrompt(sessionId, trimmed))
				.catch((sendError: unknown) => setError(describeError(sendError)));
		},
	};
}
