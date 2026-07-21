import type { NormalizedEvent } from "../ingest/types.js";

/**
 * Renders a session's events as a plain table. Deliberately unrefined —
 * turning generic BusEvent payloads into a genuinely readable conversation
 * (chat bubbles, paired tool-call cards, etc.) is a separate task
 * (conversation-tile-render-busevent-payloads-as-a-readable-thr-hgg4). This
 * function only exists so the dockview shell has real content to host today
 * instead of an empty panel.
 */
export function renderConversationView(container: HTMLElement, events: NormalizedEvent[]): void {
	const rows = events.map(renderEventRow).join("");
	container.innerHTML = `
		<div class="h-full overflow-auto p-3">
			<table class="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
				<thead class="bg-gray-50 dark:bg-gray-800 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
					<tr>
						<th class="px-3 py-2 text-left">timestamp</th>
						<th class="px-3 py-2 text-left">bus/type</th>
						<th class="px-3 py-2 text-left">correlation</th>
						<th class="px-3 py-2 text-left">payload</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
		</div>
	`;
}

function renderEventRow(event: NormalizedEvent): string {
	const time = new Date(event.timestamp).toISOString();
	const toolCall = event.toolCallId ? ` toolCallId=${event.toolCallId}` : "";
	const elapsed = event.elapsed !== undefined ? ` (${event.elapsed}ms)` : "";
	const payloadPreview = JSON.stringify(event.payload).slice(0, 160);
	return `
		<tr class="border-b border-gray-200 dark:border-gray-700">
			<td class="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400">${time}</td>
			<td class="px-3 py-1.5"><code class="text-accent-50 dark:text-accent-30">${event.bus}/${event.type}</code></td>
			<td class="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400"><code>${event.correlationId.slice(0, 8)}</code>${toolCall}${elapsed}</td>
			<td class="px-3 py-1.5 text-xs"><code>${payloadPreview}</code></td>
		</tr>
	`;
}
