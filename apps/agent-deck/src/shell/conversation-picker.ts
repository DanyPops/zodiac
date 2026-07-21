import type { Conversation } from "../graph/conversation-grouping.js";

export interface ConversationsResponse {
	conversations: Conversation[];
}

function formatRelativeTime(iso: string): string {
	const diffMs = Date.now() - new Date(iso).getTime();
	const diffMin = Math.round(diffMs / 60000);
	if (diffMin < 1) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHr = Math.round(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h ago`;
	const diffDay = Math.round(diffHr / 24);
	return `${diffDay}d ago`;
}

function conversationRowHtml(conversation: Conversation): string {
	const title = conversation.name ?? `Untitled \u2014 ${conversation.latestSessionId}`;
	const multiSession = conversation.sessionIds.length > 1;
	return `
		<button
			data-conversation-id="${conversation.id}"
			data-file-path="${conversation.latestFilePath}"
			data-session-id="${conversation.latestSessionId}"
			class="w-full text-left px-4 py-3 rounded-xl border border-gray-200/70 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors duration-150"
		>
			<div class="flex items-center justify-between gap-2">
				<p class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">${title}</p>
				<p class="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">${formatRelativeTime(conversation.lastActiveAt)}</p>
			</div>
			<div class="flex items-center gap-2 mt-1 text-[11px] text-gray-400 dark:text-gray-500">
				<span>${conversation.totalTurns} turn${conversation.totalTurns === 1 ? "" : "s"}</span>
				${conversation.totalErrors > 0 ? `<span class="text-danger-50">${conversation.totalErrors} error${conversation.totalErrors === 1 ? "" : "s"}</span>` : ""}
				${multiSession ? `<span title="Opens the most recent of ${conversation.sessionIds.length} sessions sharing this name -- merging them into one view is not built yet">${conversation.sessionIds.length} sessions (latest shown)</span>` : ""}
			</div>
		</button>
	`;
}

/**
 * Renders a Conversation picker into `container`. Calls `onSelect` with the
 * file path + session id to open when the user picks one -- deliberately
 * does not try to merge multi-session conversations into one event stream
 * here (createSessionJsonlSource takes a single file); picking a grouped
 * conversation opens its most recent session, clearly labeled as such.
 */
export async function renderConversationPicker(container: HTMLElement, onSelect: (filePath: string, sessionId: string) => void): Promise<void> {
	container.innerHTML = `
		<div class="h-full overflow-auto flex items-start justify-center p-8">
			<div class="w-full max-w-xl space-y-3">
				<h2 class="text-sm font-semibold text-gray-500 dark:text-gray-400 px-1">Conversations</h2>
				<div id="conversation-list" class="space-y-2">
					<p class="text-sm text-gray-400 dark:text-gray-500 px-1">Loading\u2026</p>
				</div>
			</div>
		</div>
	`;

	const listEl = container.querySelector<HTMLDivElement>("#conversation-list");
	if (!listEl) return;

	try {
		const response = await fetch("/api/conversations");
		const data = (await response.json()) as ConversationsResponse;
		if (data.conversations.length === 0) {
			listEl.innerHTML = `<p class="text-sm text-gray-400 dark:text-gray-500 px-1">No local Alef sessions found.</p>`;
			return;
		}
		listEl.innerHTML = data.conversations.map(conversationRowHtml).join("");
		for (const button of listEl.querySelectorAll<HTMLButtonElement>("button[data-file-path]")) {
			button.addEventListener("click", () => {
				const filePath = button.dataset.filePath;
				const sessionId = button.dataset.sessionId;
				if (filePath && sessionId) onSelect(filePath, sessionId);
			});
		}
	} catch (err) {
		listEl.innerHTML = `<p class="text-sm text-danger-50 px-1">Failed to load conversations: ${err instanceof Error ? err.message : String(err)}</p>`;
	}
}
