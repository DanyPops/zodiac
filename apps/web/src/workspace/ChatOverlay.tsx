import { ChevronDown, Grip, PanelRightOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Composer, ConversationSurface } from "../conversation/ConversationSurface.js";
import type { ConversationItem } from "../conversation/projector.js";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "../platform/surface-style.js";
import { iconButtonClassName } from "./icon-button-style.js";
import type { ChatPosition } from "./chat-drag.js";

interface ChatOverlayProps {
	readonly visible: boolean;
	readonly onPointerEnter: () => void;
	readonly onPointerLeave: () => void;
	readonly onFocusCapture: () => void;
	readonly onBlurCapture: () => void;
	readonly conversationItems: readonly ConversationItem[];
	readonly conversationLoading: boolean;
	readonly conversationError?: string;
	readonly draft: string;
	readonly onDraftChange: (value: string) => void;
	readonly onComposerFocus: () => void;
	readonly onDock: () => void;
	/** Real, user-draggable position offset from the panel's default centered anchor -- see useDraggablePosition. */
	readonly position: ChatPosition;
	readonly dragging: boolean;
	readonly onDragHandlePointerDown: (event: { clientX: number; clientY: number }) => void;
}

/** A short, single-line summary for the collapsed peek row -- richer item kinds (tool calls, transcript markers) don't have a meaningful one-line rendering of their own, so this is deliberately not ConversationRow reused at a smaller size. */
function summarizePeekItem(item: ConversationItem | undefined): string {
	if (!item) return "No messages yet.";
	// A streaming assistant reply exists as a real item before any tokens have arrived -- fall back rather than a blank, zero-height row.
	if (item.kind === "message") return item.text || "…";
	if (item.kind === "turn-marker") return `Used ${item.toolCallCount} tool${item.toolCallCount === 1 ? "" : "s"}.`;
	if (item.kind === "tool-call") return `Called ${item.toolName}`;
	return `${item.bus}/${item.type}`;
}

/**
 * The Conversation Chat Surface: a floating overlay, hidden by default.
 * `inert` (not just `aria-hidden`) while hidden, so a hidden panel can never
 * receive keyboard focus or be found by assistive tech navigation -- visual
 * hiding alone (opacity/transform) would leave it reachable.
 *
 * Collapsed ("peek", the default each time it's summoned) is deliberately
 * the same bare single-box shape as the empty-state landing's own
 * composer -- no separate panel background, border, header, or shadow
 * around it. Drag and dock hover-reveal above the box instead of taking
 * permanent header space. Expanding to the full transcript is the one state
 * that keeps real panel chrome: a scrollable multi-message view genuinely
 * needs a bounded, bordered surface, unlike a single input row.
 *
 * Positioned `absolute` within the same `relative` center column as the
 * Window Carousel and the canvas -- not `fixed` to the viewport. 3/4 width,
 * centered: supersedes matching the Carousel's own width now that the
 * Carousel itself shrinks to content width (see WindowCarousel's pill
 * layout) -- a fixed fraction of the column reads better than tracking
 * whatever width a content-sized Carousel happens to be today.
 */
export function ChatOverlay({ visible, onPointerEnter, onPointerLeave, onFocusCapture, onBlurCapture, conversationItems, conversationLoading, conversationError, draft, onDraftChange, onComposerFocus, onDock, position, dragging, onDragHandlePointerDown }: ChatOverlayProps): React.JSX.Element {
	const [expanded, setExpanded] = useState(false);

	useEffect(() => {
		if (!visible) setExpanded(false);
	}, [visible]);

	const lastItem = conversationItems[conversationItems.length - 1];

	const dragHandle = (
		<div
			role="button"
			aria-label="Drag to move Chat"
			title="Drag to move Chat"
			onPointerDown={(event) => onDragHandlePointerDown({ clientX: event.clientX, clientY: event.clientY })}
			className={cn(iconButtonClassName({ size: "sm" }), dragging ? "cursor-grabbing" : "cursor-grab")}
		>
			<Grip aria-hidden="true" size={13} />
		</div>
	);
	const dockButton = (
		<button
			type="button"
			onPointerDown={(event) => event.stopPropagation()}
			onClick={onDock}
			aria-label="Dock Chat into the active Window"
			title="Dock Chat into the active Window"
			className={iconButtonClassName({ size: "sm" })}
		>
			<PanelRightOpen aria-hidden="true" size={13} />
		</button>
	);

	return (
		<div
			role="dialog"
			aria-label="Chat"
			aria-hidden={!visible}
			inert={!visible}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
			onFocusCapture={onFocusCapture}
			onBlurCapture={onBlurCapture}
			style={{
				// Drag position composes with centering (-50%) and show/hide as chained
				// translate() functions, not Tailwind's translate-x-*/y-* utilities --
				// those can't express an arbitrary pixel offset alongside a percentage one.
				// Hidden overshoots by 1rem past its own height, not exactly 100%: this
				// panel's own "bottom-0" anchors to its parent column, which sits inset
				// from the true page edge by the root shell's own p-2 padding -- a plain
				// 100% only clears the panel's own height, leaving that padding gap as a
				// real, visible sliver of whatever sits at the panel's own top edge (its
				// height-independent, so the minimal collapsed shape exposed it first,
				// but the same leak always existed for the panel's expanded shape too).
				transform: `translateX(calc(-50% + ${position.x}px)) translateY(${visible ? "0" : "calc(100% + 2rem)"}) translateY(${position.y}px)`,
			}}
			className={cn(
				"group pointer-events-auto absolute bottom-0 left-1/2 z-40 w-3/4 outline-none",
				// No transition while actively dragging -- the position should track the
				// pointer 1:1, not lag behind it easing toward a stale target.
				!dragging && "transition-transform duration-200 ease-out motion-reduce:transition-none",
			)}
		>
			{expanded ? (
				<div className={cn(SURFACE_BG, "relative flex h-[60vh] max-h-[42rem] flex-col overflow-hidden rounded-[var(--app-corner-radius,16px)] border-[length:var(--app-line-width)] border-gray-300 shadow-lg dark:border-gray-700")}>
					<div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
						{dragHandle}
						{dockButton}
						<button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setExpanded(false)} aria-label="Collapse to the last reply" title="Collapse to the last reply" className={iconButtonClassName({ size: "sm" })}>
							<ChevronDown aria-hidden="true" size={14} />
						</button>
					</div>
					<div className="min-h-0 flex-1">
						<ConversationSurface items={conversationItems} loading={conversationLoading} error={conversationError} draft={draft} onDraftChange={onDraftChange} onComposerFocus={onComposerFocus} />
					</div>
				</div>
			) : (
				<div className="relative">
					{/* Hover/focus-revealed, absolutely positioned above the box -- zero layout weight on the box's own minimal shape at rest. */}
					<div className="absolute -top-9 right-0 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
						{dragHandle}
						{dockButton}
					</div>
					<button
						type="button"
						onClick={() => setExpanded(true)}
						aria-label="Expand chat to the full conversation"
						className="mb-1.5 block w-full truncate text-left text-xs text-gray-500 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-400 dark:hover:text-gray-200"
					>
						{summarizePeekItem(lastItem)}
					</button>
					<Composer draft={draft} onDraftChange={onDraftChange} onComposerFocus={onComposerFocus} autoFocus bare />
				</div>
			)}
		</div>
	);
}
