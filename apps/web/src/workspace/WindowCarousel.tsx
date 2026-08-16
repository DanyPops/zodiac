import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CommandButton } from "../commands/react.js";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "@zodiac/ui";
import { glyphBadgeClassName } from "./glyph-badge-style.js";
import { iconButtonClassName } from "./icon-button-style.js";
import { UTILITY_PILL_CLASSES } from "./utility-pill-style.js";
import { circularWindowDelta, computeWindowFadeOpacity, computeWindowOffsetPx, WINDOW_FADE_DISTANCE, WINDOW_ITEM_STEP_PX } from "./window-carousel-fade.js";

/** The viewport's width: just wide enough to show every Window that could still be visibly faded in (WINDOW_FADE_DISTANCE on each side of the active one), not a flex-1 fill of the whole header. */
const WINDOWS_VIEWPORT_PX = WINDOW_FADE_DISTANCE * WINDOW_ITEM_STEP_PX * 2;

/** Pixels of accumulated wheel distance needed to advance one Window. */
const WHEEL_STEP_THRESHOLD_PX = 50;
/** A gap this long between wheel events starts a new gesture, discarding any leftover accumulated distance. */
const WHEEL_GESTURE_IDLE_RESET_MS = 400;

interface WindowCarouselProps {
	readonly windowCount: number;
	readonly activeIndex: number;
	readonly onSelect: (index: number) => void;
	/** The Carousel's own scroll policy -- not the same ring as onSelect/nextWindow/previousWindow (workspace/model.ts's scrollWindow: creates/prunes ephemeral Windows at the ends instead of wrapping). */
	readonly onScroll: (direction: 1 | -1) => void;
	readonly activeWindowTitle: string;
	readonly onRenameActiveWindow: (title: string) => void;
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
export function WindowCarousel({ windowCount, activeIndex, onSelect, onScroll, activeWindowTitle, onRenameActiveWindow }: WindowCarouselProps): React.JSX.Element {
	const navRef = useRef<HTMLElement>(null);
	// Ref, not a dependency: onScroll is a fresh closure every render, and
	// this effect only needs to run once to attach the listener.
	const onScrollRef = useRef(onScroll);
	onScrollRef.current = onScroll;

	useEffect(() => {
		const nav = navRef.current;
		if (!nav) return;

		// A trackpad reports one physical swipe as dozens of small wheel events,
		// not one big one -- stepping on every raw event spins through several
		// Windows for a single gentle gesture. Distance accumulates across
		// events and only advances once WHEEL_STEP_THRESHOLD_PX is crossed,
		// capped at one step per event so a single large delta (a real mouse
		// wheel notch) still advances exactly one Window, not several.
		let accumulatedPx = 0;
		let lastEventAt = 0;

		function handleWheel(event: WheelEvent): void {
			// A trackpad's horizontal swipe is as natural as a wheel's vertical one.
			const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
			if (delta === 0) return;
			event.preventDefault();

			const now = performance.now();
			if (now - lastEventAt > WHEEL_GESTURE_IDLE_RESET_MS) accumulatedPx = 0;
			lastEventAt = now;

			accumulatedPx += delta;
			if (Math.abs(accumulatedPx) < WHEEL_STEP_THRESHOLD_PX) return;
			const direction = accumulatedPx > 0 ? 1 : -1;
			accumulatedPx -= direction * WHEEL_STEP_THRESHOLD_PX;
			onScrollRef.current(direction);
		}

		nav.addEventListener("wheel", handleWheel, { passive: false });
		return () => nav.removeEventListener("wheel", handleWheel);
	}, []);

	return (
		<div className="flex flex-col items-center gap-1 self-center">
			<nav ref={navRef} aria-label="Window Carousel" className={cn(UTILITY_PILL_CLASSES, SURFACE_BG)}>
				{/* Balances the "+" button on the other end, so the viewport (and the active Window it centers) sits at the pill's true geometric center -- the same center WindowNameRow, below, centers under. */}
				<div aria-hidden="true" className="size-7 shrink-0" />
				<CommandButton commandId="window.previous" label="Previous Window" className={iconButtonClassName({ size: "md" })}>
					<ChevronLeft aria-hidden="true" size={15} />
				</CommandButton>
				<div className="relative h-7 overflow-hidden" style={{ width: WINDOWS_VIEWPORT_PX }}>
					<ul className="absolute inset-0" aria-label="Windows">
						{Array.from({ length: windowCount }, (_, index) => (
							<WindowButton key={index} index={index} activeIndex={activeIndex} windowCount={windowCount} onSelect={onSelect} />
						))}
					</ul>
				</div>
				<CommandButton commandId="window.next" label="Next Window" className={iconButtonClassName({ size: "md" })}>
					<ChevronRight aria-hidden="true" size={15} />
				</CommandButton>
				<CommandButton commandId="window.new" label="New Window" className={iconButtonClassName({ size: "md" })}>
					<Plus aria-hidden="true" size={15} />
				</CommandButton>
			</nav>
			<WindowNameRow key={activeIndex} title={activeWindowTitle} onRename={onRenameActiveWindow} />
		</div>
	);
}

interface WindowNameRowProps {
	readonly title: string;
	readonly onRename: (title: string) => void;
}

/** The active Window's name, click-to-edit. `key={activeIndex}` on the caller side remounts this on every Window switch, so a half-typed rename never leaks onto a different Window. */
function WindowNameRow({ title, onRename }: WindowNameRowProps): React.JSX.Element {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(title);

	function commit(): void {
		setEditing(false);
		if (draft.trim() && draft.trim() !== title) onRename(draft);
	}

	if (editing) {
		return (
			<input
				autoFocus
				aria-label="Rename Window"
				value={draft}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit();
					if (event.key === "Escape") {
						setDraft(title);
						setEditing(false);
					}
				}}
				className="w-32 rounded-md border border-accent bg-white px-2 py-0.5 text-center text-[11px] text-gray-900 outline-none dark:bg-gray-800 dark:text-gray-100"
			/>
		);
	}

	return (
		<button
			type="button"
			onClick={() => setEditing(true)}
			aria-label={`Rename ${title}`}
			className="max-w-40 truncate rounded-md px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800"
		>
			{title}
		</button>
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
				data-window-index={index}
				onClick={() => onSelect(index)}
				aria-current={isActive ? "true" : undefined}
				style={{ opacity: computeWindowFadeOpacity(delta) }}
				className={cn(
					glyphBadgeClassName({ active: isActive, size: "md" }),
					"text-xs font-medium focus-visible:outline-2 focus-visible:outline-accent motion-reduce:animate-none hover:animate-wisp-breathe focus-visible:animate-wisp-breathe",
					isActive ? "animate-wisp-breathe" : "hover:bg-gray-100 dark:hover:bg-gray-700",
				)}
			>
				{index}
			</button>
		</li>
	);
}
