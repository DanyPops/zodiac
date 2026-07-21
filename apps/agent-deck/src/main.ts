import { SessionGraph } from "./graph/session-graph.js";
import { createDockviewApp } from "./shell/dockview-app.js";
import { createBrowserThemeController, type ThemeMode } from "./theme.js";
import type { NormalizedEvent } from "./ingest/types.js";

interface EventsResponse {
	filePath: string;
	sessionId: string;
	events: NormalizedEvent[];
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
		<div class="flex flex-col h-screen">
			<div class="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
				<div>
					<h1 class="text-sm font-bold text-gray-900 dark:text-gray-100">agent-deck</h1>
					<p class="text-xs text-gray-500 dark:text-gray-400">
						Session: <code>${data.sessionId}</code> — ${data.events.length} events
					</p>
				</div>
				<button
					id="theme-toggle"
					class="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
				>Theme: ${modeLabel(theme.getMode())}</button>
			</div>
			<div id="dockview-container" class="flex-1 min-h-0"></div>
		</div>
	`;

	const sessionGraph = new SessionGraph();
	for (const event of data.events) sessionGraph.ingest(event);

	const dockviewContainer = document.querySelector<HTMLDivElement>("#dockview-container");
	if (dockviewContainer) {
		const dockviewApp = createDockviewApp(dockviewContainer, sessionGraph.graph);
		dockviewApp.setDark(theme.isDark());
		theme.subscribe((isDark) => dockviewApp.setDark(isDark));
	}

	const toggleButton = document.querySelector<HTMLButtonElement>("#theme-toggle");
	toggleButton?.addEventListener("click", () => {
		theme.cycleMode();
		toggleButton.textContent = `Theme: ${modeLabel(theme.getMode())}`;
	});
}

void main();
