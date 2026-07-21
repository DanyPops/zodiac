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

/**
 * A draggable source card for the catalog shown in Conversation History.
 *
 * Shows a real, live-rendered preview of the widget's actual content, not
 * just an icon+label pill -- per direct instruction, matching how every
 * real product researched (Claude Artifacts, ChatGPT Canvas, and their
 * real open-source clones LobeChat/NextChat) shows a meaningful preview of
 * generated content even in compact/collapsed form. The preview is the
 * exact same renderer the Dashboard grid uses once dropped, just fitted
 * into a small fixed-height crop with a fade-out at the bottom rather than
 * a separate, curated "thumbnail" variant -- keeps one source of truth for
 * what each widget actually looks like instead of two renderers to keep in
 * sync. Pointer events are disabled on the preview itself so a person can
 * grab and drag the card without accidentally interacting with the tile
 * content underneath (e.g. the CI tile's own scroll area).
 */
export function fixtureSourceCardHtml(widget: FixtureWidgetDef): string {
	const category = CATEGORIES[widget.type];
	return `
		<div
			class="fixture-drag-source shrink-0 w-[240px] h-[136px] flex flex-col rounded-xl border border-gray-200/70 dark:border-gray-700/60 bg-white dark:bg-gray-900 cursor-grab active:cursor-grabbing overflow-hidden"
			data-widget-type="${widget.type}"
			gs-w="${widget.defaultSize.w}"
			gs-h="${widget.defaultSize.h}"
		>
			<div class="flex items-center gap-2 px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-700 shrink-0">
				<span class="fixture-icon shrink-0"></span>
				<span class="text-xs font-medium text-gray-700 dark:text-gray-200">${widget.title}</span>
			</div>
			<div class="relative flex-1 min-h-0">
				<div class="fixture-preview absolute inset-0 pointer-events-none text-[10px]" style="transform: scale(0.72); transform-origin: top left; width: 139%; height: 139%;"></div>
				<div class="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-white dark:from-gray-900 to-transparent"></div>
			</div>
		</div>
	`;
}

export function attachFixtureIcons(container: HTMLElement): void {
	for (const widget of FIXTURE_WIDGETS) {
		const card = container.querySelector(`[data-widget-type="${widget.type}"] .fixture-icon`);
		card?.appendChild(icon(CATEGORIES[widget.type].icon, { size: 12, className: CATEGORIES[widget.type].text }));
	}
}

/** Renders each widget's real content into its card's preview crop -- the same renderer the Dashboard grid uses once dropped. */
export function attachFixturePreviews(container: HTMLElement): void {
	for (const widget of FIXTURE_WIDGETS) {
		const preview = container.querySelector<HTMLElement>(`[data-widget-type="${widget.type}"] .fixture-preview`);
		if (preview) widget.render(preview);
	}
}
