import { X } from "lucide";
import type { DockviewGroupPanel, IGroupHeaderProps, IHeaderActionsRenderer } from "dockview";
import { icon } from "./icon.js";

const CLOSE_FADE_MS = 180;

/**
 * A single close control pinned to the actual right edge of the group's
 * header bar (dockview's createRightHeaderActionComponent), not tacked
 * onto the end of a tab label.
 *
 * This corrects a real mistake in the first pass: CategoryTabRenderer put
 * a close button inside each tab's own flex row, so it only ever reached
 * as far right as the tab's label was wide -- for a single short label in
 * a wide panel, that left the close control sitting near the panel's left
 * side, nowhere near where a native application window's title bar would
 * anchor it. "Treat each dock like an application window" means the close
 * control's position must be independent of the title's length -- exactly
 * what a header-bar action (rather than a per-tab element) gives you.
 */
export class GroupCloseAction implements IHeaderActionsRenderer {
	private readonly _element: HTMLElement;

	constructor(private readonly group: DockviewGroupPanel) {
		this._element = document.createElement("div");
		this._element.className = "flex items-center pr-1.5 h-full";
		this._element.innerHTML = `
			<button
				class="flex items-center justify-center h-[22px] w-[22px] rounded-md text-gray-400 dark:text-gray-500 hover:bg-gray-200/70 dark:hover:bg-gray-600/60 hover:text-gray-700 dark:hover:text-gray-200 transition-colors duration-150"
				title="Close"
				aria-label="Close"
			></button>
		`;
		this._element.querySelector("button")?.appendChild(icon(X, { size: 13, strokeWidth: 2 }));
		this._element.querySelector("button")?.addEventListener("click", (event) => {
			event.stopPropagation();
			this.close();
		});
	}

	get element(): HTMLElement {
		return this._element;
	}

	init(_params: IGroupHeaderProps): void {}

	private close(): void {
		const panel = this.group.activePanel;
		if (!panel) return;
		const contentEl = panel.view.content.element;
		const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (!contentEl || prefersReducedMotion) {
			panel.api.close();
			return;
		}
		contentEl.classList.add("dock-closing");
		window.setTimeout(() => panel.api.close(), CLOSE_FADE_MS);
	}

	dispose(): void {}
}
