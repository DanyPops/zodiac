import { GridStack } from "gridstack";
import { DockviewComponent, type GroupPanelPartInitParameters, type IContentRenderer } from "dockview";
import { CATEGORIES } from "../playground/category.js";
import { icon } from "../playground/icon.js";
import { createDashboardGrid, type DashboardGrid } from "./dashboard-grid.js";
import { findGeneratedWidgetPreset } from "./generated-widget.js";

const DRAG_SOURCE_SELECTOR = ".fixture-drag-source";

/**
 * Dockview is deliberately used here for the OUTER regions (Dashboard,
 * Conversation) -- not for the free-grid widget canvas inside Dashboard,
 * which stays gridstack (see dashboard-grid.ts's own comment on why: dockview's
 * model is tabs/directional splits, gridstack's is free x/y placement, and
 * conflating them was already identified as the wrong fit). This gives the
 * outer regions dockview's native drag-to-split for free: drag a panel's tab
 * to the top/bottom edge to split horizontally, to the left/right edge to
 * split vertically -- exactly the behavior asked for, with zero custom code.
 */

class DashboardRegionPanel implements IContentRenderer {
	private readonly _element: HTMLElement;
	private grid: DashboardGrid | undefined;

	constructor() {
		this._element = document.createElement("div");
		this._element.className = "h-full bg-gray-50 dark:bg-gray-900 overflow-auto p-2";
	}

	get element(): HTMLElement {
		return this._element;
	}

	init(_parameters: GroupPanelPartInitParameters): void {
		const gridEl = document.createElement("div");
		gridEl.id = "dashboard-grid";
		gridEl.className = "grid-stack";
		this._element.appendChild(gridEl);
		// setupDragIn deferred -- see createDashboardDockview, called once both
		// this panel and the Conversation panel (which owns the drag-source
		// cards) are known to exist, since dockview gives no init() ordering
		// guarantee between separate panels.
		this.grid = createDashboardGrid(gridEl, DRAG_SOURCE_SELECTOR, { setupDragIn: false });
	}

	getGrid(): DashboardGrid | undefined {
		return this.grid;
	}

	dispose(): void {
		this.grid?.dispose();
	}
}

/**
 * Starts empty -- widgets appear here as the result of asking for them
 * ("Create a widget which shows only the CI jobs I've initiated"), not
 * picked from a pre-populated shelf. addGeneratedCard is called from the
 * input box (dashboard-main.ts) once a prompt resolves to a known preset.
 */
class ConversationRegionPanel implements IContentRenderer {
	private readonly _element: HTMLElement;

	constructor() {
		this._element = document.createElement("div");
		this._element.className = "h-full bg-white dark:bg-gray-900 overflow-x-auto overflow-y-hidden p-2 flex flex-nowrap gap-2 items-center";
	}

	get element(): HTMLElement {
		return this._element;
	}

	init(_parameters: GroupPanelPartInitParameters): void {
		this.renderEmptyHint();
	}

	private renderEmptyHint(): void {
		if (this._element.children.length > 0) return;
		this._element.innerHTML = `<p class="empty-hint text-xs text-gray-400 dark:text-gray-500 px-2">Ask Alef to create a widget \u2014 it will appear here, ready to drag into the Dashboard.</p>`;
	}

	/** Returns true if the preset was recognized and a card was added. */
	addGeneratedCard(presetKey: string): boolean {
		const preset = findGeneratedWidgetPreset(presetKey);
		if (!preset) return false;

		this._element.querySelector(".empty-hint")?.remove();

		const category = CATEGORIES[preset.category];
		const card = document.createElement("div");
		card.className = "fixture-drag-source shrink-0 w-[240px] h-[136px] flex flex-col rounded-xl border border-gray-200/70 dark:border-gray-700/60 bg-white dark:bg-gray-900 cursor-grab active:cursor-grabbing overflow-hidden";
		card.setAttribute("data-widget-type", presetKey);
		card.setAttribute("gs-w", "6");
		card.setAttribute("gs-h", "4");
		card.innerHTML = `
			<div class="flex items-center gap-2 px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-700 shrink-0">
				<span class="card-icon shrink-0"></span>
				<span class="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">${preset.title}</span>
			</div>
			<div class="relative flex-1 min-h-0">
				<div class="card-preview absolute inset-0 pointer-events-none text-[10px]" style="transform: scale(0.72); transform-origin: top left; width: 139%; height: 139%;"></div>
				<div class="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-white dark:from-gray-900 to-transparent"></div>
			</div>
		`;
		card.querySelector(".card-icon")?.appendChild(icon(category.icon, { size: 12, className: category.text }));
		const previewEl = card.querySelector<HTMLElement>(".card-preview");
		if (previewEl) preset.render(previewEl);

		this._element.appendChild(card);
		// New drag sources appear after the initial GridStack.setupDragIn call
		// (createDashboardDockview) -- re-invoking is safe, it skips elements
		// that are already draggable and only picks up genuinely new ones
		// (same mechanism already relied on elsewhere in this module).
		GridStack.setupDragIn(DRAG_SOURCE_SELECTOR, { appendTo: "body", helper: "clone", handle: DRAG_SOURCE_SELECTOR });
		return true;
	}
}

export interface DashboardDockview {
	component: DockviewComponent;
	setDark(isDark: boolean): void;
	getDashboardGrid(): DashboardGrid | undefined;
	/** Returns false if the preset key wasn't recognized -- caller (the input box) surfaces this visibly. */
	addGeneratedWidget(presetKey: string): boolean;
	dispose(): void;
}

export function createDashboardDockview(container: HTMLElement): DashboardDockview {
	let dashboardPanelInstance: DashboardRegionPanel | undefined;
	let conversationPanelInstance: ConversationRegionPanel | undefined;

	const component = new DockviewComponent(container, {
		createComponent: (options): IContentRenderer => {
			switch (options.name) {
				case "dashboard":
					dashboardPanelInstance = new DashboardRegionPanel();
					return dashboardPanelInstance;
				case "conversation":
					conversationPanelInstance = new ConversationRegionPanel();
					return conversationPanelInstance;
				default:
					throw new Error(`Unknown dashboard-dockview component: ${options.name}`);
			}
		},
	});

	const dashboardPanel = component.addPanel({ id: "dashboard", component: "dashboard", title: "Dashboard" });
	const conversationPanel = component.addPanel({
		id: "conversation",
		component: "conversation",
		title: "Conversation",
		position: { referencePanel: "dashboard", direction: "below" },
	});

	// Initial split: Dashboard gets most of the vertical space, Conversation a
	// fixed strip -- matches the sketched layout's proportions as a starting
	// point; the user can still drag to any split they want afterward (drag a
	// tab to the top/bottom edge to split horizontally, left/right to split
	// vertically -- dockview's own native behavior, no custom code needed).
	dashboardPanel.group.api.setSize({ height: 520 });
	conversationPanel.group.api.setSize({ height: 192 });

	// Both panels' init() has run synchronously by this point (dockview
	// resolves createComponent/init eagerly for panels added this way, unlike
	// e.g. a hidden/inactive tab) -- verified via real measurement (ddDraggable
	// was previously never attached when this call lived inside
	// DashboardRegionPanel.init() instead, before the Conversation panel and
	// its cards existed).
	GridStack.setupDragIn(DRAG_SOURCE_SELECTOR, { appendTo: "body", helper: "clone", handle: DRAG_SOURCE_SELECTOR });

	function setDark(isDark: boolean): void {
		container.classList.toggle("dockview-theme-dark", isDark);
		container.classList.toggle("dockview-theme-light", !isDark);
	}

	return {
		component,
		setDark,
		getDashboardGrid: () => dashboardPanelInstance?.getGrid(),
		addGeneratedWidget: (presetKey: string) => conversationPanelInstance?.addGeneratedCard(presetKey) ?? false,
		dispose: () => component.dispose(),
	};
}
