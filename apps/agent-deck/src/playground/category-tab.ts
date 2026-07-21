import type { ITabRenderer, TabPartInitParameters } from "dockview";
import { CATEGORIES, type CategoryId } from "./category.js";
import { icon } from "./icon.js";

/**
 * Custom tab: category icon (bright, per-SDLC-stage color) + label. No close
 * button here -- see group-close-action.ts for why: a close control inside
 * a tab's own flex row only ever reaches as far right as the label is wide,
 * which is nowhere near a native application window's title-bar corner for
 * a short label in a wide panel. The close control lives at the group
 * header's actual right edge instead, independent of label length.
 *
 * Category color lives on the icon, not the tab's whole background -- Von
 * Restorff Effect's own guidance warns to use restraint so distinctive
 * elements don't compete with each other, and to not rely on color alone
 * (icon shape carries the same information for anyone with a color vision
 * deficiency).
 */
export class CategoryTabRenderer implements ITabRenderer {
	private readonly _element: HTMLElement;

	constructor(private readonly categoryId: CategoryId) {
		this._element = document.createElement("div");
		this._element.className = "flex items-center gap-2 h-full pl-3 pr-2 min-w-0";
	}

	get element(): HTMLElement {
		return this._element;
	}

	init(parameters: TabPartInitParameters): void {
		const category = CATEGORIES[this.categoryId];
		this._element.innerHTML = `
			<span class="tab-icon shrink-0"></span>
			<span class="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">${parameters.title}</span>
		`;
		this._element.querySelector(".tab-icon")?.appendChild(icon(category.icon, { size: 13, className: category.text }));
	}
}
