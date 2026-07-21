import { ChevronLeft, ChevronRight, Send } from "lucide";
import { renderConversationSidebar } from "./dashboard/conversation-sidebar.js";
import { createDashboardDockview } from "./dashboard/dashboard-dockview.js";
import { migrateDashboard, type DashboardLayout } from "./dashboard/dashboard-schema.js";
import { createInMemoryConversationsStore } from "./dashboard/mock-conversations.js";
import { icon } from "./playground/icon.js";
import { createBrowserThemeController } from "./theme.js";

const STORAGE_KEY = "agent-deck-dashboard-layout";
const SIDEBAR_COLLAPSE_KEY = "agent-deck-sidebar-collapsed";

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

function loadSidebarCollapsed(): boolean {
	try {
		return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "true";
	} catch {
		return false;
	}
}

function saveSidebarCollapsed(value: boolean): void {
	try {
		localStorage.setItem(SIDEBAR_COLLAPSE_KEY, String(value));
	} catch {
		// ignore
	}
}

function main(): void {
	const app = document.querySelector<HTMLDivElement>("#app");
	if (!app) return;

	const theme = createBrowserThemeController();
	let sidebarCollapsed = loadSidebarCollapsed();

	// [Collapsible Conversations sidebar] | [Dashboard + Conversation as real
	// dockview panels -- drag a tab to any edge to split horizontally or
	// vertically, native dockview behavior] / [input box].
	app.innerHTML = `
		<div class="flex h-screen p-3 gap-3">
			<aside id="conversations-sidebar" class="shrink-0 flex flex-col rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.03)] overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]">
				<div id="sidebar-header" class="flex items-center justify-between px-3 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
					<h2 class="sidebar-label text-xs font-semibold text-gray-500 dark:text-gray-400">Conversations</h2>
					<button id="sidebar-collapse-toggle" class="flex items-center justify-center h-6 w-6 rounded-md text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-150"></button>
				</div>
				<div id="conversation-sidebar" class="sidebar-label flex-1 overflow-auto p-1.5 space-y-0.5"></div>
			</aside>
			<main class="flex-1 min-w-0 flex flex-col gap-3">
				<div id="dashboard-dockview-container" class="flex-1 min-h-0 rounded-2xl border border-gray-200/70 dark:border-gray-700/60 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.03)] overflow-hidden"></div>
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

	function applySidebarCollapsed(): void {
		const sidebar = document.querySelector<HTMLElement>("#conversations-sidebar");
		const header = document.querySelector<HTMLElement>("#sidebar-header");
		sidebar?.classList.toggle("w-[220px]", !sidebarCollapsed);
		sidebar?.classList.toggle("w-[52px]", sidebarCollapsed);
		header?.classList.toggle("justify-center", sidebarCollapsed);
		header?.classList.toggle("justify-between", !sidebarCollapsed);
		for (const label of document.querySelectorAll<HTMLElement>(".sidebar-label")) {
			label.classList.toggle("hidden", sidebarCollapsed);
		}
		const toggleBtn = document.querySelector("#sidebar-collapse-toggle");
		if (toggleBtn) {
			toggleBtn.innerHTML = "";
			toggleBtn.appendChild(icon(sidebarCollapsed ? ChevronRight : ChevronLeft, { size: 14 }));
		}
	}
	applySidebarCollapsed();
	document.querySelector("#sidebar-collapse-toggle")?.addEventListener("click", () => {
		sidebarCollapsed = !sidebarCollapsed;
		saveSidebarCollapsed(sidebarCollapsed);
		applySidebarCollapsed();
	});

	const conversationsStore = createInMemoryConversationsStore();
	const sidebarEl = document.querySelector<HTMLDivElement>("#conversation-sidebar");
	if (sidebarEl) renderConversationSidebar(sidebarEl, conversationsStore);

	const dockviewContainer = document.querySelector<HTMLDivElement>("#dashboard-dockview-container");
	if (dockviewContainer) {
		const dashboardDockview = createDashboardDockview(dockviewContainer);
		dashboardDockview.setDark(theme.isDark());
		theme.subscribe((isDark) => dashboardDockview.setDark(isDark));

		const dashboard = dashboardDockview.getDashboardGrid();
		if (dashboard) {
			const persisted = loadPersistedLayout();
			if (persisted && persisted.panels.length > 0) dashboard.load(persisted);

			const gridEl = dockviewContainer.querySelector<HTMLElement>(".grid-stack");
			if (gridEl) {
				gridEl.addEventListener("dropped", () => persistLayout(dashboard.save()));
				const observer = new MutationObserver(() => persistLayout(dashboard.save()));
				observer.observe(gridEl, { childList: true, subtree: true, attributes: true });
			}
		}
	}

	document.documentElement.classList.toggle("dark", theme.isDark());
}

main();
