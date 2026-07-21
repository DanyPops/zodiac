import type { NormalizedEvent } from "./ingest/types.js";
import { createBrowserThemeController, type ThemeMode } from "./theme.js";

/**
 * Deliberately minimal: plain DOM, no dockview, no graph visualization yet.
 * This exists to prove the ingestion pipe end-to-end in a browser as fast as
 * possible. Dark/light/system theming is wired in now (this task); dockview
 * and the two real tiles are the next tasks, layered on top of this page.
 */

interface EventsResponse {
	filePath: string;
	sessionId: string;
	events: NormalizedEvent[];
}

function renderEvent(event: NormalizedEvent): string {
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

function modeLabel(mode: ThemeMode): string {
	return mode === "light" ? "Light" : mode === "dark" ? "Dark" : "System";
}

async function main(): Promise<void> {
	const app = document.querySelector<HTMLDivElement>("#app");
	if (!app) return;

	const theme = createBrowserThemeController();

	const params = new URLSearchParams(window.location.search);
	const query = params.toString();
	const response = await fetch(`/api/events${query ? `?${query}` : ""}`);
	const data = (await response.json()) as EventsResponse;

	app.innerHTML = `
		<div class="min-h-screen p-6">
			<div class="flex items-center justify-between mb-4">
				<h1 class="text-sm font-bold text-gray-900 dark:text-gray-100">agent-deck — ingested events (minimal preview)</h1>
				<button
					id="theme-toggle"
					class="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
				>Theme: ${modeLabel(theme.getMode())}</button>
			</div>
			<p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
				Session: <code>${data.sessionId}</code> — file: <code>${data.filePath}</code> — ${data.events.length} events
			</p>
			<table class="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
				<thead class="bg-gray-50 dark:bg-gray-800 text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
					<tr>
						<th class="px-3 py-2 text-left">timestamp</th>
						<th class="px-3 py-2 text-left">bus/type</th>
						<th class="px-3 py-2 text-left">correlation</th>
						<th class="px-3 py-2 text-left">payload</th>
					</tr>
				</thead>
				<tbody>
					${data.events.map(renderEvent).join("")}
				</tbody>
			</table>
		</div>
	`;

	const toggleButton = document.querySelector<HTMLButtonElement>("#theme-toggle");
	toggleButton?.addEventListener("click", () => {
		theme.cycleMode();
		toggleButton.textContent = `Theme: ${modeLabel(theme.getMode())}`;
	});
}

void main();
