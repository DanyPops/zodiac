import { GridStack } from "gridstack";
import { DockviewComponent, type GroupPanelPartInitParameters, type IContentRenderer } from "dockview";
import { createDashboardGrid, type DashboardGrid } from "./dashboard-grid.js";
import { attachFixtureIcons, attachFixturePreviews, fixtureSourceCardHtml, FIXTURE_WIDGETS } from "./fixture-widgets.js";

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

class ConversationRegionPanel implements IContentRenderer {
	private readonly _element: HTMLElement;

	constructor() {
		this._element = document.createElement("div");
		this._element.className = "h-full bg-white dark:bg-gray-900 overflow-x-auto overflow-y-hidden p-2 flex flex-nowrap gap-2";
	}

	get element(): HTMLElement {
		return this._element;
	}

	init(_parameters: GroupPanelPartInitParameters): void {
		this._element.innerHTML = FIXTURE_WIDGETS.map(fixtureSourceCardHtml).join("");
		attachFixtureIcons(this._element);
		attachFixturePreviews(this._element);
	}
}

export interface DashboardDockview {
	component: DockviewComponent;
	setDark(isDark: boolean): void;
	getDashboardGrid(): DashboardGrid | undefined;
	dispose(): void;
}

export function createDashboardDockview(container: HTMLElement): DashboardDockview {
	let dashboardPanelInstance: DashboardRegionPanel | undefined;

	const component = new DockviewComponent(container, {
		createComponent: (options): IContentRenderer => {
			switch (options.name) {
				case "dashboard":
					dashboardPanelInstance = new DashboardRegionPanel();
					return dashboardPanelInstance;
				case "conversation":
					return new ConversationRegionPanel();
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
	// e.g. a hidden/inactive tab) -- the fixture cards exist now, so this is
	// safe, verified via real measurement (ddDraggable was previously never
	// attached when this call lived inside DashboardRegionPanel.init() instead).
	GridStack.setupDragIn(DRAG_SOURCE_SELECTOR, { appendTo: "body", helper: "clone", handle: DRAG_SOURCE_SELECTOR });

	function setDark(isDark: boolean): void {
		container.classList.toggle("dockview-theme-dark", isDark);
		container.classList.toggle("dockview-theme-light", !isDark);
	}

	return {
		component,
		setDark,
		getDashboardGrid: () => dashboardPanelInstance?.getGrid(),
		dispose: () => component.dispose(),
	};
}
