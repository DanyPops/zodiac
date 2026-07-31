import { ConversationSurface } from "../conversation/ConversationSurface.js";
import type { ConversationItem } from "../conversation/projector.js";

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
}

/**
 * The Conversation Chat Surface: a floating overlay, hidden by default.
 * `inert` (not just `aria-hidden`) while hidden, so a hidden panel can never
 * receive keyboard focus or be found by assistive tech navigation -- visual
 * hiding alone (opacity/transform) would leave it reachable.
 */
export function ChatOverlay({ visible, onPointerEnter, onPointerLeave, onFocusCapture, onBlurCapture, conversationItems, conversationLoading, conversationError, draft, onDraftChange, onComposerFocus }: ChatOverlayProps): React.JSX.Element {
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
			className={`pointer-events-auto fixed inset-x-0 bottom-0 z-40 mx-auto flex h-[60vh] max-h-[42rem] w-[min(48rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-t-xl border border-b-0 border-gray-300 bg-white shadow-2xl outline-none transition-transform duration-200 ease-out motion-reduce:transition-none dark:border-gray-700 dark:bg-gray-900 ${visible ? "translate-y-0" : "translate-y-full"}`}
		>
			<div className="flex h-9 shrink-0 items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-700">
				<h2 className="text-xs font-semibold text-gray-950 dark:text-white">Chat</h2>
				<span className="text-[10px] text-gray-600 dark:text-gray-300">Conversation Surface — summon with the bottom edge or its keymap</span>
			</div>
			<div className="min-h-0 flex-1">
				<ConversationSurface items={conversationItems} loading={conversationLoading} error={conversationError} draft={draft} onDraftChange={onDraftChange} onComposerFocus={onComposerFocus} />
			</div>
		</div>
	);
}
