import type { NormalizedEvent } from "./ingest/types.js";

/**
 * Deliberately minimal: plain DOM, no dockview, no theme, no graph
 * visualization yet. This exists to prove the ingestion pipe end-to-end in a
 * browser as fast as possible — the dockview shell, dark/light theme, and
 * sigma.js graph tile are the next task, layered on top of this once it's
 * confirmed working with real data.
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
		<tr>
			<td>${time}</td>
			<td><code>${event.bus}/${event.type}</code></td>
			<td><code>${event.correlationId.slice(0, 8)}</code>${toolCall}${elapsed}</td>
			<td><code>${payloadPreview}</code></td>
		</tr>
	`;
}

async function main(): Promise<void> {
	const app = document.querySelector<HTMLDivElement>("#app");
	if (!app) return;

	const params = new URLSearchParams(window.location.search);
	const query = params.toString();
	const response = await fetch(`/api/events${query ? `?${query}` : ""}`);
	const data = (await response.json()) as EventsResponse;

	app.innerHTML = `
		<h1>agent-deck — ingested events (minimal preview)</h1>
		<p>Session: <code>${data.sessionId}</code> — file: <code>${data.filePath}</code> — ${data.events.length} events</p>
		<table border="1" cellpadding="4" cellspacing="0">
			<thead>
				<tr><th>timestamp</th><th>bus/type</th><th>correlation</th><th>payload</th></tr>
			</thead>
			<tbody>
				${data.events.map(renderEvent).join("")}
			</tbody>
		</table>
	`;
}

void main();
