import { useEffect, useRef, useState } from "react";
import { SessionGraph } from "../graph/session-graph.js";
import type { NormalizedEvent } from "../ingest/types.js";
import type { ConversationClient, ConversationSummary } from "./client.js";
import { buildConversationItems, type ConversationItem } from "./projector.js";

export interface ConversationWorkspace {
	conversations: readonly ConversationSummary[];
	conversationsLoading: boolean;
	selectedConversationId: string | undefined;
	conversationItems: readonly ConversationItem[];
	conversationLoading: boolean;
	conversationError: string | undefined;
	/** Records which conversation button last received focus, for openConversation's fallback chain. */
	notifyConversationFocused: (conversationId: string) => void;
	/**
	 * Resolves conversationId against the last-focused, then currently
	 * selected, then first-listed conversation, and selects it. Returns the
	 * resolved id (or undefined when there is nothing to open yet) so a
	 * caller can decide whether to also switch the visible surface.
	 */
	openConversation: (conversationId?: string) => string | undefined;
	appendUserMessage: (text: string) => void;
}

function toConversationItems(events: readonly NormalizedEvent[]): ConversationItem[] {
	const graph = new SessionGraph();
	for (const event of events) graph.ingest(event);
	return buildConversationItems(graph.graph);
}

function describeError(error: unknown): string {
	return error instanceof Error ? `Conversation unavailable (${error.message}).` : "Conversation unavailable.";
}

export function useConversationWorkspace(client: ConversationClient): ConversationWorkspace {
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [conversationsLoading, setConversationsLoading] = useState(true);
	const [selectedConversationId, setSelectedConversationId] = useState<string>();
	const [conversationItems, setConversationItems] = useState<ConversationItem[]>([]);
	const [conversationLoading, setConversationLoading] = useState(false);
	const [conversationError, setConversationError] = useState<string>();
	const focusedConversationIdRef = useRef<string>(undefined);

	useEffect(() => {
		const abort = new AbortController();
		setConversationsLoading(true);
		client
			.list(abort.signal)
			.then((loaded) => {
				setConversations(loaded);
				setSelectedConversationId((current) => current ?? loaded[0]?.id);
			})
			.catch((error: unknown) => {
				if (!abort.signal.aborted) setConversationError(describeError(error));
			})
			.finally(() => {
				if (!abort.signal.aborted) setConversationsLoading(false);
			});
		return () => abort.abort();
	}, [client]);

	useEffect(() => {
		if (!selectedConversationId) return;
		const abort = new AbortController();
		setConversationLoading(true);
		setConversationError(undefined);
		client
			.loadEvents(selectedConversationId, abort.signal)
			.then((events) => setConversationItems(toConversationItems(events)))
			.catch((error: unknown) => {
				if (!abort.signal.aborted) setConversationError(describeError(error));
			})
			.finally(() => {
				if (!abort.signal.aborted) setConversationLoading(false);
			});
		return () => abort.abort();
	}, [client, selectedConversationId]);

	return {
		conversations,
		conversationsLoading,
		selectedConversationId,
		conversationItems,
		conversationLoading,
		conversationError,
		notifyConversationFocused(conversationId) {
			focusedConversationIdRef.current = conversationId;
		},
		openConversation(conversationId) {
			const id = conversationId ?? focusedConversationIdRef.current ?? selectedConversationId ?? conversations[0]?.id;
			if (id) setSelectedConversationId(id);
			return id;
		},
		appendUserMessage(text) {
			setConversationItems((items) => [...items, { kind: "message", role: "user", text, timestamp: Date.now() }]);
		},
	};
}
