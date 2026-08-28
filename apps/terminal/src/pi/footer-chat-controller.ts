import type { AgentIntegrationPort, AgentSessionControlOutcome, ZodiacAgentEvent } from "@zodiac/agent";

/** Bounds how many conversation items this controller retains -- an unbounded history in a long-lived TUI process is exactly the kind of resource the rest of this codebase already refuses to leave unbound (see the walking-skeleton event-bus task's own bounded-subscriber/history conventions). Oldest items are dropped first. */
const MAX_ITEMS = 200;

/**
 * A tool item's `status` mirrors Pi TUI's own tool-execution model directly:
 * pending/success/error there drives a background-color state
 * (toolPendingBg/toolSuccessBg/toolErrorBg in its own theme), not inline
 * text -- so it's tracked here as real data, not baked into `text`, letting
 * the renderer apply the same color-coded-by-status convention instead of a
 * plain-text glyph standing in for it.
 */
export type FooterChatItem =
	| { readonly role: "user"; readonly text: string }
	| { readonly role: "assistant"; readonly text: string }
	| { readonly role: "tool"; readonly text: string; readonly status: "pending" | "success" | "error" };

/**
 * What the Footer region can show. `items` is the real conversation history
 * (bounded, see MAX_ITEMS) -- the collapsed single-row view just renders its
 * last entry; the expanded view (see the shell's own expandFooter/collapseFooter)
 * renders as many as fit above the composer line.
 */
export type FooterChatStatus =
	| { readonly kind: "unavailable" }
	| LiveFooterChatStatus;

/**
 * The subset of FooterChatStatus a real, live FooterChatController can
 * actually produce -- "unavailable" isn't one of them, since that state
 * means "no controller was ever constructed" (no model configured,
 * construction failed, ...), a fact only the caller holding an
 * `undefined` in place of a controller can know. Narrowing snapshot()'s
 * return type this way means every live state always carries `items`
 * without every caller re-checking for a variant this type can't produce.
 */
export type LiveFooterChatStatus = (
	| { readonly kind: "composing"; readonly draft: string; readonly items: readonly FooterChatItem[] }
	| { readonly kind: "busy"; readonly draft: string; readonly items: readonly FooterChatItem[] }
	| { readonly kind: "idle"; readonly draft: string; readonly items: readonly FooterChatItem[] }
	| { readonly kind: "error"; readonly draft: string; readonly message: string; readonly items: readonly FooterChatItem[] }
) & { readonly activity?: "turn" | "compaction"; readonly sessionName?: string };

export interface FooterChatController {
	snapshot: () => LiveFooterChatStatus;
	subscribe: (listener: () => void) => () => void;
	/** Appends one character to the draft -- called per keystroke, not per paste; a real paste/IME path is out of scope for this slice. */
	typeChar: (char: string) => void;
	backspace: () => void;
	/** Sends the current draft as a prompt (steer()-equivalent while already streaming, via the port's own prompt() convenience) and clears it. No-op on an empty/whitespace-only draft. */
	submit: () => void;
	setModel: (provider: string, modelId: string) => Promise<AgentSessionControlOutcome>;
	compact: (customInstructions?: string) => Promise<AgentSessionControlOutcome>;
	resume: (sessionPath: string) => Promise<AgentSessionControlOutcome>;
	fork: (entryId: string) => Promise<AgentSessionControlOutcome>;
	dispose: () => void;
}

/**
 * Owns one live AgentIntegrationPort and projects it into the Footer's own
 * bounded conversation view -- real history, not just a single status line,
 * so an expanded Footer has something real to show.
 */
export function createFooterChatController(integration: AgentIntegrationPort, options: { readonly onAgentEvent?: (event: ZodiacAgentEvent) => void } = {}): FooterChatController {
	let draft = "";
	let items: FooterChatItem[] = [];
	/** Index into `items` of the assistant entry currently streaming, if any -- distinguishes "keep replacing this turn's item" from "start a new one". */
	let streamingAssistantIndex: number | undefined;
	const toolItemIndexByCallId = new Map<string, number>();
	let busy = false;
	let activity: "turn" | "compaction" | undefined;
	let sessionName: string | undefined;
	let error: string | undefined;
	const listeners = new Set<() => void>();

	function notify(): void {
		for (const listener of listeners) listener();
	}

	function pushItem(item: FooterChatItem): number {
		items = [...items, item];
		if (items.length > MAX_ITEMS) {
			const overflow = items.length - MAX_ITEMS;
			items = items.slice(overflow);
			streamingAssistantIndex = streamingAssistantIndex === undefined ? undefined : streamingAssistantIndex - overflow;
			for (const [callId, index] of toolItemIndexByCallId) toolItemIndexByCallId.set(callId, index - overflow);
		}
		return items.length - 1;
	}

	function replaceItem(index: number, item: FooterChatItem): void {
		if (index < 0 || index >= items.length) return;
		const next = [...items];
		next[index] = item;
		items = next;
	}

	function handleEvent(event: ZodiacAgentEvent): void {
		options.onAgentEvent?.(event);
		switch (event.type) {
			case "agent-start":
				busy = true;
				error = undefined;
				notify();
				return;
			case "agent-settled":
				busy = false;
				activity = undefined;
				streamingAssistantIndex = undefined;
				notify();
				return;
			case "turn-start":
				activity = "turn";
				notify();
				return;
			case "turn-end":
				if (activity === "turn") activity = undefined;
				notify();
				return;
			case "compaction-start":
				activity = "compaction";
				busy = true;
				notify();
				return;
			case "compaction-end":
				if (activity === "compaction") activity = undefined;
				if (event.errorMessage) error = event.errorMessage;
				notify();
				return;
			case "session-info-changed":
				sessionName = event.name;
				notify();
				return;
			case "assistant-message-start":
				streamingAssistantIndex = pushItem({ role: "assistant", text: "" });
				notify();
				return;
			case "assistant-message-delta":
				if (streamingAssistantIndex === undefined) streamingAssistantIndex = pushItem({ role: "assistant", text: "" });
				replaceItem(streamingAssistantIndex, { role: "assistant", text: event.text });
				notify();
				return;
			case "assistant-message-end":
				if (streamingAssistantIndex === undefined) streamingAssistantIndex = pushItem({ role: "assistant", text: "" });
				replaceItem(streamingAssistantIndex, { role: "assistant", text: event.text || "(empty response)" });
				notify();
				return;
			case "tool-call-start":
				toolItemIndexByCallId.set(event.toolCallId, pushItem({ role: "tool", text: event.toolName, status: "pending" }));
				notify();
				return;
			case "tool-call-update":
				// The Footer's compact tool row intentionally shows status rather than
				// potentially huge output, but the update still repaints so expanded
				// renderers can consume richer item details later without a port change.
				notify();
				return;
			case "tool-call-end": {
				const index = toolItemIndexByCallId.get(event.toolCallId);
				if (index !== undefined) replaceItem(index, { role: "tool", text: event.toolName, status: event.isError ? "error" : "success" });
				notify();
				return;
			}
			case "error":
				error = event.message;
				busy = false;
				notify();
				return;
		}
	}

	const unsubscribe = integration.onEvent(handleEvent);
	const unsubscribeExit = integration.onExit((reason) => {
		if (reason) error = reason;
		busy = false;
		notify();
	});

	const unsupportedControl = (name: string): AgentSessionControlOutcome => ({ ok: false, reason: "unsupported", message: `This Agent Integration does not support ${name}.` });

	return {
		snapshot() {
			const metadata = { ...(activity !== undefined ? { activity } : {}), ...(sessionName !== undefined ? { sessionName } : {}) };
			if (error) return { kind: "error", draft, message: error, items, ...metadata };
			if (busy) return { kind: "busy", draft, items, ...metadata };
			if (items.length > 0) return { kind: "idle", draft, items, ...metadata };
			return { kind: "composing", draft, items, ...metadata };
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		typeChar(char) {
			draft += char;
			notify();
		},
		backspace() {
			draft = draft.slice(0, -1);
			notify();
		},
		submit() {
			const trimmed = draft.trim();
			if (!trimmed) return;
			draft = "";
			error = undefined;
			pushItem({ role: "user", text: trimmed });
			void integration.prompt(trimmed).catch((sendError: unknown) => {
				error = sendError instanceof Error ? sendError.message : String(sendError);
				busy = false;
				notify();
			});
			notify();
		},
		setModel: (provider, modelId) => integration.session?.setModel(provider, modelId) ?? Promise.resolve(unsupportedControl("model switching")),
		compact: (customInstructions) => integration.session?.compact(customInstructions) ?? Promise.resolve(unsupportedControl("manual compaction")),
		resume: (sessionPath) => integration.session?.resume(sessionPath) ?? Promise.resolve(unsupportedControl("session resume")),
		fork: (entryId) => integration.session?.fork(entryId) ?? Promise.resolve(unsupportedControl("session fork")),
		dispose() {
			unsubscribe();
			unsubscribeExit();
			listeners.clear();
		},
	};
}
