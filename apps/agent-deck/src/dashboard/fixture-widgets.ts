import { CATEGORIES, type CategoryId } from "../playground/category.js";
import { icon } from "../playground/icon.js";
import { renderCITile } from "../playground/tiles/ci-tile.js";
import { renderPRsTile } from "../playground/tiles/prs-tile.js";
import { renderTerminalTile } from "../playground/tiles/terminal-tile.js";
import { renderTicketsTile } from "../playground/tiles/tickets-tile.js";
import { renderWorkflowTile } from "../playground/tiles/workflow-tile.js";

export interface FixtureWidgetDef {
	type: CategoryId;
	title: string;
	defaultSize: { w: number; h: number };
	render: (container: HTMLElement) => void;
}

/**
 * Draggable widget catalog for the Dashboard, sourced from the playground's
 * existing mock tiles (CI/Tickets/PRs/Terminal/Workflow) -- reused rather
 * than duplicated, per the task's instruction to develop drag-and-drop
 * against fixtures instead of live data. In the sketched product, these
 * would be widgets the conversation dynamically spawns; here they're the
 * fixed catalog a person drags from Conversation History into the Dashboard.
 */
export const FIXTURE_WIDGETS: FixtureWidgetDef[] = [
	{ type: "ci", title: "CI", defaultSize: { w: 6, h: 4 }, render: renderCITile },
	{ type: "tickets", title: "Tickets", defaultSize: { w: 4, h: 4 }, render: renderTicketsTile },
	{ type: "prs", title: "PRs", defaultSize: { w: 4, h: 4 }, render: renderPRsTile },
	{ type: "terminal", title: "Terminal", defaultSize: { w: 5, h: 3 }, render: renderTerminalTile },
	{ type: "workflow", title: "Workflow", defaultSize: { w: 6, h: 3 }, render: renderWorkflowTile },
];

export function findFixtureWidget(type: string): FixtureWidgetDef | undefined {
	return FIXTURE_WIDGETS.find((w) => w.type === type);
}

/** A draggable source card for the catalog shown in Conversation History. */
export function fixtureSourceCardHtml(widget: FixtureWidgetDef): string {
	const category = CATEGORIES[widget.type];
	return `
		<div
			class="fixture-drag-source flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200/70 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 cursor-grab active:cursor-grabbing"
			data-widget-type="${widget.type}"
			gs-w="${widget.defaultSize.w}"
			gs-h="${widget.defaultSize.h}"
		>
			<span class="fixture-icon shrink-0"></span>
			<span class="text-sm font-medium text-gray-700 dark:text-gray-200">${widget.title}</span>
		</div>
	`;
}

export function attachFixtureIcons(container: HTMLElement): void {
	for (const widget of FIXTURE_WIDGETS) {
		const card = container.querySelector(`[data-widget-type="${widget.type}"] .fixture-icon`);
		card?.appendChild(icon(CATEGORIES[widget.type].icon, { size: 14, className: CATEGORIES[widget.type].text }));
	}
}
