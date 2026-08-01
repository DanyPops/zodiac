import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { CommandButton } from "../commands/react.js";
import { cn } from "../platform/cn.js";
import { circularWindowDelta, computeWindowFadeOpacity, computeWindowOffsetPx } from "./window-carousel-fade.js";

interface WindowCarouselProps {
	readonly windowCount: number;
	readonly activeIndex: number;
	readonly onSelect: (index: number) => void;
	/** Same wrap-around ring as onSelect/nextWindow/previousWindow (workspace/model.ts's scrollWindow). */
	readonly onScroll: (direction: 1 | -1) => void;
}

/**
 * A Workspace's numbered Windows. Clicks, keyboard, and the wheel all share
 * one wrap-around ring (workspace/model.ts). Visually the active Window
 * sits centered (a coverflow effect); neighbors fade with circular
 * distance (window-carousel-fade.ts) so the ring reads as a loop, not a
 * dead-ended strip.
 *
 * The wheel listener is attached natively via ref/effect, not React's
 * `onWheel` prop: React attaches wheel listeners as passive, so
 * `preventDefault()` inside `onWheel` is silently ignored and the
 * browser's own default scroll still fires alongside ours. `{ passive:
 * false }` is the only way around that; there's no React prop for it.
 */
export function WindowCarousel({ windowCount, activeIndex, onSelect, onScroll }: WindowCarouselProps): React.JSX.Element {
	const navRef = useRef<HTMLElement>(null);
	// Ref, not a dependency: onScroll is a fresh closure every render, and
	// this effect only needs to run once to attach the listener.
	const onScrollRef = useRef(onScroll);
	onScrollRef.current = onScroll;

	useEffect(() => {
		const nav = navRef.current;
		if (!nav) return;

		function handleWheel(event: WheelEvent): void {
			// A trackpad's horizontal swipe is as natural as a wheel's vertical one.
			const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
			if (delta === 0) return;
			event.preventDefault();
			onScrollRef.current(delta > 0 ? 1 : -1);
		}

		nav.addEventListener("wheel", handleWheel, { passive: false });
		return () => nav.removeEventListener("wheel", handleWheel);
	}, []);

	return (
		<nav ref={navRef} aria-label="Window Carousel" className="flex h-10 shrink-0 items-center gap-1 rounded-[var(--app-corner-radius,16px)] bg-gray-50 px-2 dark:bg-gray-900">
			<CommandButton commandId="window.previous" label="Previous Window" className="grid size-7 place-items-center rounded-md text-gray-600 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800">
				<ChevronLeft aria-hidden="true" size={15} />
			</CommandButton>
			<div className="relative h-7 min-w-0 flex-1 overflow-hidden">
				<ul className="absolute inset-0" aria-label="Windows">
					{Array.from({ length: windowCount }, (_, index) => (
						<WindowButton key={index} index={index} activeIndex={activeIndex} windowCount={windowCount} onSelect={onSelect} />
					))}
				</ul>
			</div>
			<CommandButton commandId="window.next" label="Next Window" className="grid size-7 place-items-center rounded-md text-gray-600 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800">
				<ChevronRight aria-hidden="true" size={15} />
			</CommandButton>
			<CommandButton commandId="window.new" label="New Window" className="grid size-7 place-items-center rounded-md text-gray-600 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800">
				<Plus aria-hidden="true" size={15} />
			</CommandButton>
		</nav>
	);
}

interface WindowButtonProps {
	readonly index: number;
	readonly activeIndex: number;
	readonly windowCount: number;
	readonly onSelect: (index: number) => void;
}

/** One Window's glyph, positioned by its circular delta from the active Window (not raw index), so it can sit on either side of a wrap boundary. */
function WindowButton({ index, activeIndex, windowCount, onSelect }: WindowButtonProps): React.JSX.Element {
	const isActive = index === activeIndex;
	const delta = circularWindowDelta(index, activeIndex, windowCount);
	const offsetPx = computeWindowOffsetPx(delta);
	return (
		<li className="absolute top-0 left-1/2" style={{ transform: `translateX(calc(-50% + ${offsetPx}px))` }}>
			<button
				type="button"
				onClick={() => onSelect(index)}
				aria-current={isActive ? "true" : undefined}
				style={{ opacity: computeWindowFadeOpacity(delta) }}
				className={cn("grid size-7 place-items-center rounded-md text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent", isActive ? "bg-accent-10 text-accent-60 dark:bg-accent-80 dark:text-accent-30" : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800")}
			>
				{index}
			</button>
		</li>
	);
}
