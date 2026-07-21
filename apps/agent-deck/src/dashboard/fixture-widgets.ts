import type { CategoryId } from "../playground/category.js";
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
 * The base (unfiltered) renderer per category. No longer directly exposed
 * as a draggable pre-populated catalog in the UI -- per direct correction,
 * a widget's identity is a type PLUS a specific scope asked for
 * (generated-widget.ts's GENERATED_WIDGET_PRESETS), not a bare type picked
 * off a shelf. This registry now exists purely as the resolution fallback
 * dashboard-grid.ts's resolveWidget() falls back to, and as the underlying
 * renderer generated-widget.ts's presets call with a filter applied.
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
