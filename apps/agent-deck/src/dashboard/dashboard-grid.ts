import { GridStack, type GridStackNode, type GridStackWidget } from "gridstack";
import type { DashboardLayout, DashboardPanel } from "./dashboard-schema.js";
import { emptyDashboard } from "./dashboard-schema.js";
import { findFixtureWidget } from "./fixture-widgets.js";

export interface DashboardGrid {
	save(): DashboardLayout;
	load(layout: DashboardLayout): void;
	dispose(): void;
}

/**
 * Wraps gridstack.js (chosen over dockview -- dockview's own real
 * toJSON/fromJSON serialization is an IDE-docking model, tabs and directional
 * splits, not free grid placement; chosen over react-grid-layout -- requires
 * React, doesn't fit this codebase's vanilla-TS stack; verified both via
 * their actual type definitions / npm registry, not assumed).
 *
 * External drag-in (GridStack.setupDragIn) is how fixture widget cards in
 * Conversation History become droppable into this grid -- the dropped
 * element only carries a data-widget-type attribute; this module is
 * responsible for turning that into the fixture's real rendered content.
 */
export function createDashboardGrid(container: HTMLElement, dragSourceSelector: string): DashboardGrid {
	const grid = GridStack.init(
		{
			column: 12,
			cellHeight: 60,
			margin: 6,
			acceptWidgets: true,
			removable: false,
		},
		container,
	);
	if (!grid) throw new Error("GridStack.init() returned null -- container element not ready");

	// handle defaults to '.grid-stack-item-content' (gridstack's own internal
	// grid-item marker class) -- our fixture cards don't have that class, so
	// without overriding it here, drag never initiates at all (verified via a
	// real headless-Chromium drag attempt: 0 grid items resulted until this
	// was set explicitly to match our own card class).
	GridStack.setupDragIn(dragSourceSelector, { appendTo: "body", helper: "clone", handle: dragSourceSelector });

	function renderPanelContent(el: HTMLElement, type: string, title: string): void {
		const contentEl = el.querySelector<HTMLElement>(".grid-stack-item-content");
		if (!contentEl) return;
		contentEl.className = "grid-stack-item-content rounded-xl border border-gray-200/70 dark:border-gray-700/60 bg-white dark:bg-gray-900 overflow-hidden";
		const widget = findFixtureWidget(type);
		if (!widget) {
			contentEl.innerHTML = `<p class="p-3 text-xs text-gray-400">Unknown widget type: ${type}</p>`;
			return;
		}
		contentEl.innerHTML = "";
		const header = document.createElement("div");
		header.className = "text-xs font-medium text-gray-500 dark:text-gray-400 px-2 py-1 border-b border-gray-200/70 dark:border-gray-700/60";
		header.textContent = title;
		const body = document.createElement("div");
		body.className = "h-[calc(100%-25px)]";
		contentEl.appendChild(header);
		contentEl.appendChild(body);
		widget.render(body);
	}

	grid.on("dropped", (_event, _previousNode, newNode: GridStackNode) => {
		const el = newNode.el;
		const type = el?.getAttribute("data-widget-type");
		if (!el || !type) return;
		const widget = findFixtureWidget(type);
		renderPanelContent(el, type, widget?.title ?? type);
	});

	return {
		save(): DashboardLayout {
			const saved = grid.save(false) as GridStackWidget[];
			const panels: DashboardPanel[] = saved
				.filter((w): w is GridStackWidget & { id: string; x: number; y: number; w: number; h: number } => typeof w.id === "string" && typeof w.x === "number" && typeof w.y === "number" && typeof w.w === "number" && typeof w.h === "number")
				.map((w) => {
					const el = container.querySelector<HTMLElement>(`[gs-id="${w.id}"]`);
					const type = el?.getAttribute("data-widget-type") ?? "unknown";
					return {
						id: w.id,
						type,
						title: findFixtureWidget(type)?.title ?? type,
						gridPos: { x: w.x, y: w.y, w: w.w, h: w.h },
					};
				});
			return { schemaVersion: 1, panels };
		},
		load(layout: DashboardLayout): void {
			grid.removeAll();
			for (const panel of layout.panels) {
				const el = grid.addWidget({
					id: panel.id,
					x: panel.gridPos.x,
					y: panel.gridPos.y,
					w: panel.gridPos.w,
					h: panel.gridPos.h,
				});
				if (el) {
					el.setAttribute("data-widget-type", panel.type);
					renderPanelContent(el, panel.type, panel.title);
				}
			}
		},
		dispose(): void {
			grid.destroy(true);
		},
	};
}

export { emptyDashboard };
