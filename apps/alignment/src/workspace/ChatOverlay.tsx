import { ChevronDown, ChevronUp, PanelRightOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Composer, ConversationRow, ConversationSurface } from "../conversation/ConversationSurface.js";
import type { ConversationItem } from "../conversation/projector.js";
import { cn } from "../platform/cn.js";
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

/**
 * The Conversation Chat Surface: a floating overlay, hidden by default.
 * `inert` (not just `aria-hidden`) while hidden, so a hidden panel can never
 * receive keyboard focus or be found by assistive tech navigation -- visual
 * hiding alone (opacity/transform) would leave it reachable.
 *
 * Two states while visible: collapsed ("peek", the default each time it's
 * summoned) shows only the composer and the most recent reply; clicking the
 * peek area expands to the full transcript. This mirrors a real chat
 * notification pattern -- see enough to react without committing to the
 * whole conversation view.
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
				transform: `translateX(calc(-50% + ${position.x}px)) translateY(${visible ? "0" : "100%"}) translateY(${position.y}px)`,
			}}
			className={cn(
				// A floating pill, not a drawer anchored to the bottom edge -- rounded on every corner, bordered on every side.
				"pointer-events-auto absolute bottom-0 left-1/2 z-40 flex w-3/4 flex-col overflow-hidden rounded-[var(--app-corner-radius,16px)] border-[length:var(--app-line-width)] border-gray-300 bg-white shadow-2xl outline-none dark:border-gray-700 dark:bg-gray-900",
				expanded ? "h-[60vh] max-h-[42rem]" : "max-h-[16rem]",
				// No transition while actively dragging -- the position should track the
				// pointer 1:1, not lag behind it easing toward a stale target.
				!dragging && "transition-transform duration-200 ease-out motion-reduce:transition-none",
			)}
		>
			<div
				onPointerDown={(event) => onDragHandlePointerDown({ clientX: event.clientX, clientY: event.clientY })}
				className={cn("flex h-9 shrink-0 items-center gap-2 border-b-[length:var(--app-line-width)] border-gray-200 px-3 dark:border-gray-700", dragging ? "cursor-grabbing" : "cursor-grab")}
			>
				<h2 className="text-xs font-semibold text-gray-950 dark:text-white">Chat</h2>
				<span className="truncate text-[10px] text-gray-600 dark:text-gray-300">Conversation Surface — drag to move, or summon with the bottom edge or its keymap</span>
				{/* stopPropagation: these live inside the drag handle, but clicking them must never itself start a drag gesture. */}
				<button
					type="button"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={onDock}
					aria-label="Dock Chat into the active Window"
					className={cn("grid size-6 shrink-0 place-items-center rounded-md text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-gray-800", !expanded && "ml-auto")}
				>
					<PanelRightOpen aria-hidden="true" size={13} />
				</button>
				{expanded && (
					<button
						type="button"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={() => setExpanded(false)}
						aria-label="Collapse to the last reply"
						className="ml-auto grid size-6 shrink-0 place-items-center rounded-md text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-gray-800"
					>
						<ChevronDown aria-hidden="true" size={14} />
					</button>
				)}
			</div>

			{expanded ? (
				<div className="min-h-0 flex-1">
					<ConversationSurface items={conversationItems} loading={conversationLoading} error={conversationError} draft={draft} onDraftChange={onDraftChange} onComposerFocus={onComposerFocus} />
				</div>
			) : (
				<>
					{/* p-3, matching Composer's own outer padding below -- same left/right edges, not independently centered. */}
					<button
						type="button"
						onClick={() => setExpanded(true)}
						aria-label="Expand chat to the full conversation"
						className="flex min-h-0 flex-1 flex-col items-stretch gap-1 overflow-hidden p-3 text-left hover:bg-gray-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent dark:hover:bg-gray-800/60"
					>
						<span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
							<ChevronUp aria-hidden="true" size={11} />
							Last reply
						</span>
						<div className="min-h-0 overflow-hidden">{lastItem ? <ConversationRow item={lastItem} /> : <p className="text-sm text-gray-600 dark:text-gray-300">No messages yet.</p>}</div>
					</button>
					<Composer draft={draft} onDraftChange={onDraftChange} onComposerFocus={onComposerFocus} />
				</>
			)}
		</div>
	);
}
