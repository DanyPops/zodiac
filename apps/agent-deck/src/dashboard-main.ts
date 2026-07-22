import { ChevronLeft, ChevronRight, Send } from "lucide";
import { renderConversationSidebar } from "./dashboard/conversation-sidebar.js";
import { createDashboardDockview } from "./dashboard/dashboard-dockview.js";
import { migrateDashboard, type DashboardLayout } from "./dashboard/dashboard-schema.js";
import { parseWidgetPrompt } from "./dashboard/generated-widget.js";
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
			<aside id="conversations-sidebar" class="shrink-0 flex flex-col rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.03)] overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.68,-0.6,0.32,1.6)]">
				<div id="sidebar-header" class="sidebar-expanded-only flex items-center justify-between px-3 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
					<h2 class="text-xs font-semibold text-gray-500 dark:text-gray-400">Conversations</h2>
					<button id="sidebar-collapse-toggle" class="flex items-center justify-center h-6 w-6 rounded-md text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-150" title="Collapse"></button>
				</div>
				<div id="conversation-sidebar" class="sidebar-expanded-only flex-1 overflow-auto p-1.5 space-y-0.5"></div>
				<button id="sidebar-expand-toggle" class="sidebar-collapsed-only h-10 w-10 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300" title="Show conversations"></button>
			</aside>
			<main class="flex-1 min-w-0 flex flex-col gap-3">
				<div id="dashboard-dockview-container" class="flex-1 min-h-0 rounded-2xl border border-gray-200/70 dark:border-gray-700/60 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.03)] overflow-hidden"></div>
				<div>
					<div class="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.03)]">
						<input
							id="prompt-input"
							type="text"
							placeholder="Ask Alef to create a widget\u2026 e.g. &quot;Create a widget which shows only the CI jobs I\u2019ve initiated&quot;"
							title="Not wired to a live Alef/LLM yet -- recognizes a small fixed set of example prompts (fixture phase)"
							class="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none"
						/>
						<button id="input-send" class="flex items-center justify-center h-8 w-8 rounded-xl bg-accent-10 dark:bg-accent-80 text-accent-60 dark:text-accent-20 hover:bg-accent-20 dark:hover:bg-accent-70 transition-colors"></button>
					</div>
					<p id="prompt-error" class="hidden text-xs text-danger-50 px-2 pt-1.5"></p>
				</div>
			</main>
		</div>
	`;

	app.querySelector("#input-send")?.appendChild(icon(Send, { size: 15 }));

	// Collapse hides the sidebar entirely rather than narrowing it to an
	// icon-only strip -- what's left is a single small floating button (not a
	// full-height bar) reminding the user how to bring it back, per direct
	// correction.
	//
	// Both width AND height must be real, explicit, animatable length values
	// for the collapse to read as a genuine diagonal shrink toward the
	// top-left corner. The original version toggled align-self (self-stretch
	// <-> self-start) to control height, but align-self is a keyword, not a
	// length -- browsers cannot interpolate between two alignment keywords,
	// so it snapped instantly while width eased smoothly, producing a
	// sideways-then-snap motion instead of a diagonal one (confirmed: this is
	// exactly what was reported). h-[calc(100vh_-_24px)] (100vh minus the
	// outer flex container's p-3 top+bottom padding) gives the expanded state
	// a real, resize-safe pixel height the browser can tween against h-10
	// (40px) collapsed -- once both axes are explicit lengths, the parent's
	// default flex align-items: stretch naturally falls back to top-alignment
	// for a definite (non-auto) cross size, so no align-self class is needed
	// at all; both dimensions now shrink from the same top-left-anchored
	// point, at the same time, with the same rubber-band curve.
	//
	// The width/height transition itself uses cubic-bezier(0.68, -0.6, 0.32,
	// 1.6) -- the standard "easeInOutBack" curve -- instead of a plain ease.
	// A CSS transition-timing-function's control points aren't clamped to
	// [0,1]: a negative y1 makes the animated value dip *below* its starting
	// point before it starts moving toward the target (a rubber band's initial
	// give), and a y2 above 1 makes it overshoot *past* the target before
	// settling back (the band's snap-back oscillation) -- both purely via the
	// timing function, no extra keyframes needed, so it applies symmetrically
	// whether the sidebar is collapsing or expanding.
	function applySidebarCollapsed(): void {
		const sidebar = document.querySelector<HTMLElement>("#conversations-sidebar");
		sidebar?.classList.toggle("w-[220px]", !sidebarCollapsed);
		sidebar?.classList.toggle("h-[calc(100vh_-_24px)]", !sidebarCollapsed);
		sidebar?.classList.toggle("w-10", sidebarCollapsed);
		sidebar?.classList.toggle("h-10", sidebarCollapsed);
		for (const el of document.querySelectorAll<HTMLElement>(".sidebar-expanded-only")) {
			el.classList.toggle("hidden", sidebarCollapsed);
		}
		for (const el of document.querySelectorAll<HTMLElement>(".sidebar-collapsed-only")) {
			el.classList.toggle("hidden", !sidebarCollapsed);
		}
		const collapseBtn = document.querySelector("#sidebar-collapse-toggle");
		if (collapseBtn) {
			collapseBtn.innerHTML = "";
			collapseBtn.appendChild(icon(ChevronLeft, { size: 14 }));
		}
		const expandBtn = document.querySelector("#sidebar-expand-toggle");
		if (expandBtn) {
			expandBtn.innerHTML = "";
			expandBtn.appendChild(icon(ChevronRight, { size: 14 }));
		}
	}
	applySidebarCollapsed();
	function toggleSidebar(): void {
		sidebarCollapsed = !sidebarCollapsed;
		saveSidebarCollapsed(sidebarCollapsed);
		applySidebarCollapsed();
	}
	document.querySelector("#sidebar-collapse-toggle")?.addEventListener("click", toggleSidebar);
	document.querySelector("#sidebar-expand-toggle")?.addEventListener("click", toggleSidebar);

	const conversationsStore = createInMemoryConversationsStore();
	const sidebarEl = document.querySelector<HTMLDivElement>("#conversation-sidebar");
	if (sidebarEl) renderConversationSidebar(sidebarEl, conversationsStore);

	const dockviewContainer = document.querySelector<HTMLDivElement>("#dashboard-dockview-container");
	let dashboardDockview: ReturnType<typeof createDashboardDockview> | undefined;
	if (dockviewContainer) {
		dashboardDockview = createDashboardDockview(dockviewContainer);
		dashboardDockview.setDark(theme.isDark());
		theme.subscribe((isDark) => dashboardDockview?.setDark(isDark));

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

	// Fixture-phase prompt handling: a small fixed set of recognized requests
	// (generated-widget.ts), not a live LLM/Alef yet. Unrecognized prompts fail
	// visibly rather than silently doing nothing or guessing, per direct
	// requirement.
	function submitPrompt(): void {
		const input = document.querySelector<HTMLInputElement>("#prompt-input");
		const errorEl = document.querySelector<HTMLElement>("#prompt-error");
		const prompt = input?.value.trim();
		if (!input || !errorEl || !prompt) return;

		const presetKey = parseWidgetPrompt(prompt);
		const added = presetKey ? (dashboardDockview?.addGeneratedWidget(presetKey) ?? false) : false;

		if (added) {
			input.value = "";
			errorEl.classList.add("hidden");
		} else {
			errorEl.textContent = "Sorry, I don't recognize that widget request yet.";
			errorEl.classList.remove("hidden");
		}
	}
	document.querySelector("#input-send")?.addEventListener("click", submitPrompt);
	document.querySelector("#prompt-input")?.addEventListener("keydown", (event) => {
		if ((event as KeyboardEvent).key === "Enter") submitPrompt();
	});

	document.documentElement.classList.toggle("dark", theme.isDark());
}

main();
