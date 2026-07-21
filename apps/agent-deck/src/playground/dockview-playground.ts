import { DockviewComponent, type GroupPanelPartInitParameters, type IContentRenderer, type ITabRenderer } from "dockview";
import { CategoryTabRenderer } from "./category-tab.js";
import type { CategoryId } from "./category.js";
import { GroupCloseAction } from "./group-close-action.js";
import { renderCITile } from "./tiles/ci-tile.js";
import { renderPRsTile } from "./tiles/prs-tile.js";
import { renderTerminalTile } from "./tiles/terminal-tile.js";
import { renderTicketsTile } from "./tiles/tickets-tile.js";
import { renderWorkflowTile } from "./tiles/workflow-tile.js";

type TileRenderer = (container: HTMLElement) => void;

class StaticTilePanel implements IContentRenderer {
	private readonly _element: HTMLElement;

	constructor(private readonly render: TileRenderer) {
		this._element = document.createElement("div");
		// Explicit background rather than relying on dockview's own panel
		// background: DockviewComponent defaults to its built-in "abyss" theme
		// (always dark) unless a `theme` option is passed, so the abyss
		// background shows through any content that doesn't set its own --
		// same root cause fixed for the Observability tile in the real app.
		this._element.className = "h-full bg-white dark:bg-gray-900";
	}

	get element(): HTMLElement {
		return this._element;
	}

	init(_parameters: GroupPanelPartInitParameters): void {
		this.render(this._element);
	}
}

const TILE_RENDERERS: Record<string, TileRenderer> = {
	ci: renderCITile,
	tickets: renderTicketsTile,
	terminal: renderTerminalTile,
	prs: renderPRsTile,
	workflow: renderWorkflowTile,
};

export interface DockviewPlayground {
	component: DockviewComponent;
	setDark(isDark: boolean): void;
	dispose(): void;
}

/**
 * Five mock tile types proving the dock/undock/drag/resize/popout primitives
 * with visually distinct content, before any real data source is wired in.
 * See doc research/ task tiling-primitives-playground-... -- this is
 * deliberately separate from the real Alef-wired app (dockview-app.ts).
 */
export function createDockviewPlayground(container: HTMLElement): DockviewPlayground {
	const component = new DockviewComponent(container, {
		createComponent: (options): IContentRenderer => {
			const render = TILE_RENDERERS[options.name];
			if (!render) throw new Error(`Unknown playground tile: ${options.name}`);
			return new StaticTilePanel(render);
		},
		// One shared custom tab (icon + label) for every panel -- options.id is
		// this playground's own panel id ("ci", "tickets", ...), which doubles
		// as the CategoryId key since they're defined to match.
		defaultTabComponent: "category-tab",
		createTabComponent: (options): ITabRenderer => new CategoryTabRenderer(options.id as CategoryId),
		// Close control pinned to the group header's actual right edge --
		// see group-close-action.ts for why this replaced a per-tab close button.
		createRightHeaderActionComponent: (group) => new GroupCloseAction(group),
	});

	// initialWidth/initialHeight hints were tried here first but are not
	// reliably honored for this chained-split pattern (verified empirically:
	// panel sizes stayed unchanged regardless of the hint value) -- setting
	// each group's size explicitly via its panel API after all panels exist
	// is the approach that actually produces a balanced default layout.
	// The user can still drag/resize freely afterward.
	const ci = component.addPanel({ id: "ci", component: "ci", title: "CI" });
	const tickets = component.addPanel({
		id: "tickets",
		component: "tickets",
		title: "Tickets",
		position: { referencePanel: "ci", direction: "right" },
	});
	const workflow = component.addPanel({
		id: "workflow",
		component: "workflow",
		title: "Workflow",
		position: { referencePanel: "ci", direction: "below" },
	});
	const prs = component.addPanel({
		id: "prs",
		component: "prs",
		title: "PRs",
		position: { referencePanel: "tickets", direction: "below" },
	});
	const terminal = component.addPanel({
		id: "terminal",
		component: "terminal",
		title: "Terminal",
		position: { referencePanel: "workflow", direction: "right" },
	});

	ci.group.api.setSize({ width: 780, height: 520 });
	tickets.group.api.setSize({ width: 420 });
	workflow.group.api.setSize({ height: 320 });
	prs.group.api.setSize({ height: 320 });
	terminal.group.api.setSize({ width: 420 });

	function setDark(isDark: boolean): void {
		container.classList.toggle("dockview-theme-dark", isDark);
		container.classList.toggle("dockview-theme-light", !isDark);
	}

	return {
		component,
		setDark,
		dispose: () => component.dispose(),
	};
}
