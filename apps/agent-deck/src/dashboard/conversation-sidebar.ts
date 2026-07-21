import type { Conversation } from "../graph/conversation-grouping.js";
import type { ConversationsStore } from "./mock-conversations.js";

/**
 * Compact sidebar list variant of the full-page picker (conversation-picker.ts).
 * Takes a ConversationsStore rather than fetching -- currently backed by the
 * in-memory mock store (mock-conversations.ts) for this layout/drag-drop
 * build phase; the real disk-backed store (conversations-api.ts) is separate,
 * already-shipped work and can be wired in behind the same interface later.
 */
export function renderConversationSidebar(container: HTMLElement, store: ConversationsStore): void {
	const conversations = store.list();
	if (conversations.length === 0) {
		container.innerHTML = `<p class="text-xs text-gray-400 dark:text-gray-500 px-2">No conversations.</p>`;
		return;
	}
	container.innerHTML = conversations.map(rowHtml).join("");
}

function rowHtml(conversation: Conversation): string {
	const title = conversation.name ?? `Untitled \u2014 ${conversation.latestSessionId}`;
	return `
		<button class="w-full text-left px-2.5 py-2 rounded-lg text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors duration-150 truncate">
			${title}
		</button>
	`;
}
