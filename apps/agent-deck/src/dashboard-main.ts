import { Send } from "lucide";
import { renderConversationSidebar } from "./dashboard/conversation-sidebar.js";
import { createDashboardGrid } from "./dashboard/dashboard-grid.js";
import { migrateDashboard, type DashboardLayout } from "./dashboard/dashboard-schema.js";
import { attachFixtureIcons, fixtureSourceCardHtml, FIXTURE_WIDGETS } from "./dashboard/fixture-widgets.js";
import { createInMemoryConversationsStore } from "./dashboard/mock-conversations.js";
import { icon } from "./playground/icon.js";
import { createBrowserThemeController } from "./theme.js";

const STORAGE_KEY = "agent-deck-dashboard-layout";

function loadPersistedLayout(): DashboardLayout | undefined {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return undefined;
		return migrateDashboard(JSON.parse(raw));
	} catch {
		return undefined;
	}
}

function persistLayout(layout: DashboardLayout): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
	} catch {
		// ignore storage write failures (private mode, quota, etc.)
	}
}

function main(): void {
	const app = document.querySelector<HTMLDivElement>("#app");
	if (!app) return;

	const theme = createBrowserThemeController();

	// Sketched 4-region layout: [Conversations sidebar] | [Dashboard grid (top) /
	// Conversation History with draggable fixture widgets (bottom) / input box].
	app.innerHTML = `
		<div class="flex h-screen p-3 gap-3">
			<aside class="w-[220px] shrink-0 flex flex-col rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.03)] overflow-hidden">
				<h2 class="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 py-3 border-b border-gray-100 dark:border-gray-700">Conversations</h2>
				<div id="conversation-sidebar" class="flex-1 overflow-auto p-1.5 space-y-0.5"></div>
			</aside>
			<main class="flex-1 min-w-0 flex flex-col gap-3">
				<section class="flex-1 min-h-0 rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-gray-50 dark:bg-gray-900 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.03)] overflow-auto p-2">
					<div id="dashboard-grid" class="grid-stack"></div>
				</section>
				<section class="h-[168px] shrink-0 rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.03)] overflow-hidden flex flex-col">
					<h2 class="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
						Conversation History <span class="font-normal text-gray-400 dark:text-gray-500">\u00b7 drag a widget into the dashboard above</span>
					</h2>
					<div id="conversation-history" class="flex-1 overflow-auto p-2 flex flex-wrap gap-2 content-start"></div>
				</section>
				<div class="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.03)]">
					<input
						type="text"
						placeholder="Message Alef\u2026"
						disabled
						title="Not wired to a live Alef session yet -- visual placeholder only, per the sketched layout"
						class="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none disabled:cursor-not-allowed"
					/>
					<button id="input-send" disabled class="flex items-center justify-center h-8 w-8 rounded-xl bg-accent-10 dark:bg-accent-80 text-accent-60 dark:text-accent-20 disabled:opacity-50"></button>
				</div>
			</main>
		</div>
	`;

	app.querySelector("#input-send")?.appendChild(icon(Send, { size: 15 }));

	const historyEl = document.querySelector<HTMLDivElement>("#conversation-history");
	if (historyEl) {
		historyEl.innerHTML = FIXTURE_WIDGETS.map(fixtureSourceCardHtml).join("");
		attachFixtureIcons(historyEl);
	}

	const conversationsStore = createInMemoryConversationsStore();
	const sidebarEl = document.querySelector<HTMLDivElement>("#conversation-sidebar");
	if (sidebarEl) renderConversationSidebar(sidebarEl, conversationsStore);

	const gridEl = document.querySelector<HTMLDivElement>("#dashboard-grid");
	if (gridEl) {
		const dashboard = createDashboardGrid(gridEl, ".fixture-drag-source");
		const persisted = loadPersistedLayout();
		if (persisted && persisted.panels.length > 0) dashboard.load(persisted);

		// Persist on any change (add/move/resize/drop) -- gridstack fires "change" for these.
		gridEl.addEventListener("dropped", () => persistLayout(dashboard.save()));
		const observer = new MutationObserver(() => persistLayout(dashboard.save()));
		observer.observe(gridEl, { childList: true, subtree: true, attributes: true });
	}

	// Theme toggling is app-wide (see main.ts/playground-main.ts) -- this page
	// doesn't have its own toggle yet since the sketch didn't call for one;
	// it still respects the persisted mode via createBrowserThemeController.
	document.documentElement.classList.toggle("dark", theme.isDark());
}

main();
