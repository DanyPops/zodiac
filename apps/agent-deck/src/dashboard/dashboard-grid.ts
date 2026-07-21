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
export function createDashboardGrid(container: HTMLElement, dragSourceSelector: string, options: { setupDragIn?: boolean } = {}): DashboardGrid {
	const grid = GridStack.init(
		{
			column: 12,
			cellHeight: 60,
			margin: 6,
			// Root cause of "nothing happens when I drop it inside", confirmed via
			// direct measurement (getBoundingClientRect), not guessed: gridstack
			// computes its own height from content and collapses to 0px when empty
			// (default minRow is 0). The large empty area a person sees is the
			// parent <section>'s background -- the actual grid-stack element,
			// the only thing with drop-target behavior attached, occupied zero
			// real pixels, so no drop could ever land "inside" it. This affected
			// a real human, not just automation -- confirmed by the user directly.
			minRow: 8,
			// acceptWidgets: true resolves internally to accepting only elements
			// matching '.grid-stack-item' (gridstack's own internal marker class,
			// meant for dragging between two existing grids) -- our fixture cards
			// don't have that class and never will, so the real fix is passing our
			// own selector here, not `true`. Found by reading gridstack's actual
			// accept-predicate source (dist/gridstack.js), not guessed: every prior
			// symptom (drag starts and the ghost tracks correctly, but drop never
			// completes under real headless-Chromium mouse simulation) is fully
			// explained by this -- it was never a simulation/automation artifact.
			acceptWidgets: dragSourceSelector,
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
	//
	// Defaults to true, but callable=false when the drag-source elements live
	// in a *different* dockview panel than this grid (dashboard-dockview.ts):
	// dockview gives no ordering guarantee between separate panels' init(), so
	// calling this here can run before the fixture cards even exist in the DOM
	// -- confirmed via measurement (ddDraggable was never attached, 0 grid
	// items resulted, not a mouse-simulation issue this time). The caller is
	// then responsible for calling GridStack.setupDragIn itself once both
	// panels are known to exist -- safe to call more than once, it skips
	// elements that are already draggable.
	if (options.setupDragIn ?? true) {
		GridStack.setupDragIn(dragSourceSelector, { appendTo: "body", helper: "clone", handle: dragSourceSelector });
	}

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
		// Second real bug in the same feature, found the same way (measurement,
		// not guessing): items dropped via external drag-in never get an `id`
		// at all (confirmed: saved node had x/y/w/h but no id field), so
		// save()'s filter correctly rejected them as malformed -- the drop
		// visually succeeded but silently produced an empty persisted layout.
		// Assign one at drop time, before anything can call save().
		if (!newNode.id) {
			grid.update(el, { id: `panel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
		}
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
