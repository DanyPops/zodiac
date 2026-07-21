import { X } from "lucide";
import type { ITabRenderer, TabPartInitParameters } from "dockview";
import { CATEGORIES, type CategoryId } from "./category.js";
import { icon } from "./icon.js";

/** Matches the CSS transition duration in styles.css (.dock-closing). */
const CLOSE_FADE_MS = 180;

/**
 * Custom tab: category icon (bright, per-SDLC-stage color) + label + close
 * button. Replaces dockview's default plain-text tab.
 *
 * Design decisions, grounded in research rather than guessed:
 * - Close control stays at the tab's trailing (right) edge -- this is the
 *   explicit ask, and also the convention every user already knows from
 *   browser tabs, VS Code, and dockview's own default (Jakob's Law: don't
 *   make people learn a new pattern for something this common). This is
 *   deliberately NOT macOS's own traffic-light convention, which is
 *   top-left -- verified via Apple's HIG discussion threads before writing
 *   this, not assumed.
 * - Close hit target is a full 22x22px box with its own hover background,
 *   not a bare 12px icon -- Fitts's Law: small, unpadded targets are slow
 *   and error-prone to hit precisely.
 * - Category color lives on the icon + a thin bottom accent, not the tab's
 *   whole background -- Von Restorff Effect's own guidance warns to use
 *   restraint so distinctive elements don't compete with each other, and
 *   to not rely on color alone (icon shape carries the same information
 *   for anyone with a color vision deficiency).
 * - The close fade (see styles.css .dock-closing) is brief and respects
 *   prefers-reduced-motion, per Apple's HIG on motion: purposeful, optional,
 *   not decorative.
 */
export class CategoryTabRenderer implements ITabRenderer {
	private readonly _element: HTMLElement;

	constructor(private readonly categoryId: CategoryId) {
		this._element = document.createElement("div");
		this._element.className = "flex items-center gap-2 h-full pl-3 pr-1.5 min-w-0";
	}

	get element(): HTMLElement {
		return this._element;
	}

	init(parameters: TabPartInitParameters): void {
		const category = CATEGORIES[this.categoryId];
		this._element.innerHTML = `
			<span class="tab-icon shrink-0"></span>
			<span class="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">${parameters.title}</span>
			<button
				class="tab-close-btn shrink-0 flex items-center justify-center h-[22px] w-[22px] rounded-md text-gray-400 dark:text-gray-500 hover:bg-gray-200/70 dark:hover:bg-gray-600/60 hover:text-gray-700 dark:hover:text-gray-200 transition-colors duration-150"
				title="Close"
				aria-label="Close ${parameters.title}"
			></button>
		`;
		this._element.querySelector(".tab-icon")?.appendChild(icon(category.icon, { size: 13, className: category.text }));
		this._element.querySelector(".tab-close-btn")?.appendChild(icon(X, { size: 13, strokeWidth: 2 }));

		this._element.querySelector(".tab-close-btn")?.addEventListener("click", (event) => {
			event.stopPropagation();
			const panel = parameters.containerApi.getPanel(parameters.api.id);
			const contentEl = panel?.view.content.element;
			if (!contentEl) {
				parameters.api.close();
				return;
			}
			contentEl.classList.add("dock-closing");
			const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			if (prefersReducedMotion) {
				parameters.api.close();
				return;
			}
			window.setTimeout(() => parameters.api.close(), CLOSE_FADE_MS);
		});
	}
}
