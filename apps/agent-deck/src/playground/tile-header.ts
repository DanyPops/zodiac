import { CATEGORIES, type CategoryId } from "./category.js";
import { icon } from "./icon.js";

/**
 * Shared content-level header for every tile: a colored top accent bar
 * (the same bright per-SDLC-stage color as the tab) plus an icon chip and
 * subtitle. Kept as a small reusable block so all 5 tiles stay visually
 * consistent rather than each hand-rolling its own header markup.
 */
export function tileHeaderHtml(categoryId: CategoryId, subtitle: string): string {
	const category = CATEGORIES[categoryId];
	return `
		<div class="border-t-[3px] ${category.accentBorder} -mt-3 -mx-3 mb-3 px-3 pt-3">
			<div class="flex items-center gap-2">
				<span class="tile-header-icon flex items-center justify-center h-6 w-6 rounded-lg ${category.chipBg} ${category.text} shrink-0"></span>
				<span class="text-xs text-gray-500 dark:text-gray-400">${subtitle}</span>
			</div>
		</div>
	`;
}

export function attachTileHeaderIcon(container: HTMLElement, categoryId: CategoryId): void {
	const category = CATEGORIES[categoryId];
	container.querySelector(".tile-header-icon")?.appendChild(icon(category.icon, { size: 13 }));
}
