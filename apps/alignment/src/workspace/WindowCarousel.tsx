import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { WheelEvent } from "react";
import { CommandButton } from "../commands/react.js";

interface WindowCarouselProps {
	readonly windowCount: number;
	readonly activeIndex: number;
	readonly onSelect: (index: number) => void;
	/** The mouse-wheel policy (workspace/model.ts's scrollWindow): move within existing Windows, or create one past either edge -- distinct from onSelect's direct-jump-by-index and from the keyboard commands' wrap-around. */
	readonly onScroll: (direction: 1 | -1) => void;
}

/**
 * The Window Carousel: a Workspace's numbered Windows, left (0) to right
 * (last). Direct clicks and the keyboard commands (window.next/window.previous)
 * wrap at both ends; the mouse wheel instead creates a new empty Window past
 * either edge -- see workspace/model.ts's scrollWindow, which this only
 * drives, never reimplements.
 */
export function WindowCarousel({ windowCount, activeIndex, onSelect, onScroll }: WindowCarouselProps): React.JSX.Element {
	function handleWheel(event: WheelEvent<HTMLDivElement>): void {
		// Whichever axis moved further decides direction -- a plain mouse wheel
		// only ever reports deltaY, but a trackpad's horizontal swipe (deltaX)
		// is at least as natural for a left-to-right carousel and should drive
		// it the same way.
		const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
		if (delta === 0) return;
		event.preventDefault();
		onScroll(delta > 0 ? 1 : -1);
	}

	return (
		<nav aria-label="Window Carousel" className="flex h-10 shrink-0 items-center gap-1 rounded-[var(--app-corner-radius,16px)] bg-gray-50 px-2 dark:bg-gray-900" onWheel={handleWheel}>
			<CommandButton commandId="window.previous" label="Previous Window" className="grid size-7 place-items-center rounded-md text-gray-600 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800">
				<ChevronLeft aria-hidden="true" size={15} />
			</CommandButton>
			<ul className="flex flex-1 items-center gap-1 overflow-x-auto" aria-label="Windows">
				{Array.from({ length: windowCount }, (_, index) => (
					<li key={index}>
						<button
							type="button"
							onClick={() => onSelect(index)}
							aria-current={index === activeIndex ? "true" : undefined}
							className={`grid size-7 place-items-center rounded-md text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent ${index === activeIndex ? "bg-accent-10 text-accent-60 dark:bg-accent-80 dark:text-accent-30" : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800"}`}
						>
							{index}
						</button>
					</li>
				))}
			</ul>
			<CommandButton commandId="window.next" label="Next Window" className="grid size-7 place-items-center rounded-md text-gray-600 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800">
				<ChevronRight aria-hidden="true" size={15} />
			</CommandButton>
			<CommandButton commandId="window.new" label="New Window" className="grid size-7 place-items-center rounded-md text-gray-600 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800">
				<Plus aria-hidden="true" size={15} />
			</CommandButton>
		</nav>
	);
}
