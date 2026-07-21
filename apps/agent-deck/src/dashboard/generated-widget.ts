import { CURRENT_USER } from "../playground/mock-data.js";
import type { CategoryId } from "../playground/category.js";
import { renderCITile } from "../playground/tiles/ci-tile.js";
import { renderTicketsTile } from "../playground/tiles/tickets-tile.js";

/**
 * A widget's identity is a type PLUS a specific scope, not a bare type
 * picked off a fixed shelf -- per direct correction: "Create a widget which
 * shows only the CI jobs I've initiated" and "Create a widget which only
 * shows the bugs which are assigned to me" are each a distinct widget, not
 * two instances of the same generic "CI" or "Tickets" widget.
 *
 * Fixture-level prompt parsing (keyword matching, not real NLP/LLM) --
 * matches the current mock-data build phase. Each recognized prompt maps to
 * a fixed preset key, which is what actually gets persisted in
 * DashboardPanel.type (dashboard-schema.ts) -- keeps the schema plain JSON
 * (no closures to serialize) while still letting a dropped/reloaded widget
 * reconstruct its exact filtered view via GENERATED_WIDGET_PRESETS below.
 */

export interface GeneratedWidgetPreset {
	category: CategoryId;
	title: string;
	render: (container: HTMLElement) => void;
}

export const GENERATED_WIDGET_PRESETS: Record<string, GeneratedWidgetPreset> = {
	"ci-initiated-by-me": {
		category: "ci",
		title: "CI jobs I've initiated",
		render: (container) =>
			renderCITile(container, {
				filter: (run) => run.initiatedBy === CURRENT_USER,
				subtitle: "CI jobs I've initiated \u00b7 synthetic data",
			}),
	},
	"tickets-assigned-to-me": {
		category: "tickets",
		title: "Bugs assigned to me",
		render: (container) =>
			renderTicketsTile(container, {
				filter: (issue) => issue.assignee === CURRENT_USER,
				subtitle: "Bugs assigned to me \u00b7 synthetic data",
			}),
	},
};

export function findGeneratedWidgetPreset(presetKey: string): GeneratedWidgetPreset | undefined {
	return GENERATED_WIDGET_PRESETS[presetKey];
}

/**
 * Parses a natural-language widget request into a preset key. Returns
 * undefined for anything unrecognized -- callers must fail visibly (per
 * the task's explicit requirement), not silently produce nothing or guess.
 */
export function parseWidgetPrompt(prompt: string): string | undefined {
	const text = prompt.toLowerCase();
	const mentionsMe = /\b(me|my|i've|i have)\b/.test(text);
	const mentionsCI = /\b(ci|job|jobs|build|builds|pipeline)\b/.test(text);
	const mentionsInitiated = /\b(initiat|trigger|started|ran|run)/.test(text);
	const mentionsIssue = /\b(bug|bugs|ticket|tickets|issue|issues)\b/.test(text);
	const mentionsAssigned = /\bassign/.test(text);

	if (mentionsCI && mentionsInitiated && mentionsMe) return "ci-initiated-by-me";
	if (mentionsIssue && mentionsAssigned && mentionsMe) return "tickets-assigned-to-me";
	return undefined;
}
