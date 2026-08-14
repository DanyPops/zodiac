import { ChevronDown, PanelRightOpen } from "lucide-react";
import { useState } from "react";
import { Composer, ConversationSurface } from "../conversation/ConversationSurface.js";
import type { ConversationItem } from "../conversation/projector.js";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "../platform/surface-style.js";
import { iconButtonClassName } from "./icon-button-style.js";

interface ChatPanelProps {
	readonly conversationItems: readonly ConversationItem[];
	readonly conversationLoading: boolean;
	readonly conversationError?: string;
	readonly draft: string;
	readonly onDraftChange: (value: string) => void;
	readonly onComposerFocus: () => void;
	readonly onDock: () => void;
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
 * The Conversation Chat Surface: a permanent, always-visible part of the
 * Workspace shell -- not a pop-up. Mounted only while Chat isn't docked into
 * a Window (see App.tsx's `chatIsGlobal`); docking it moves the conversation
 * into a Window tab instead, which is the one way it ever leaves view.
 *
 * Collapsed ("peek", the default) is the same bare single-box shape as the
 * empty-state landing's own composer -- no separate panel background,
 * border, or shadow around it. Expanding to the full transcript is the one
 * state that keeps real panel chrome: a scrollable multi-message view
 * genuinely needs a bounded, bordered surface, unlike a single input row.
 *
 * A normal flex sibling below the canvas, not `absolute`/floating -- it
 * takes its own real space instead of overlaying content, and never needs
 * repositioning since nothing sits underneath it to cover.
 */
export function ChatPanel({ conversationItems, conversationLoading, conversationError, draft, onDraftChange, onComposerFocus, onDock }: ChatPanelProps): React.JSX.Element {
	const [expanded, setExpanded] = useState(false);
	const lastItem = conversationItems[conversationItems.length - 1];

	return (
		// role="complementary", not "region": dockview auto-generates its own role="region" for a docked group, labeled from whatever the active panel's own title is -- since the docked Chat instance's title is literally "Chat", a region here would collide with dockview's own once Chat is docked (verified live, not assumed). complementary is never something dockview itself produces.
		<div role="complementary" aria-label="Chat" className="w-full shrink-0">
			{expanded ? (
				<div className={cn(SURFACE_BG, "relative flex h-[60vh] max-h-[42rem] flex-col overflow-hidden rounded-[var(--app-corner-radius,16px)] border-[length:var(--app-line-width)] border-gray-300 shadow-lg dark:border-gray-700")}>
					<div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
						<button type="button" onClick={onDock} aria-label="Dock Chat into the active Window" title="Dock Chat into the active Window" className={iconButtonClassName({ size: "sm" })}>
							<PanelRightOpen aria-hidden="true" size={13} />
						</button>
						<button type="button" onClick={() => setExpanded(false)} aria-label="Collapse to the last reply" title="Collapse to the last reply" className={iconButtonClassName({ size: "sm" })}>
							<ChevronDown aria-hidden="true" size={14} />
						</button>
					</div>
					<div className="min-h-0 flex-1">
						<ConversationSurface items={conversationItems} loading={conversationLoading} error={conversationError} draft={draft} onDraftChange={onDraftChange} onComposerFocus={onComposerFocus} />
					</div>
				</div>
			) : (
				<div className="relative">
					<div className="mb-1.5 flex items-center gap-2">
						<button
							type="button"
							onClick={() => setExpanded(true)}
							aria-label="Expand chat to the full conversation"
							// text-gray-600, not the lighter -500 used for the same hint elsewhere: those sit on CanvasWell's own WELL_BG surface, this row sits directly on the page background (a real axe color-contrast failure caught live, not assumed).
							className="min-w-0 flex-1 truncate text-left text-xs text-gray-600 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:text-gray-200"
						>
							{summarizePeekItem(lastItem)}
						</button>
						<button type="button" onClick={onDock} aria-label="Dock Chat into the active Window" title="Dock Chat into the active Window" className={iconButtonClassName({ size: "sm" })}>
							<PanelRightOpen aria-hidden="true" size={13} />
						</button>
					</div>
					{/* autoFocus: whenever this panel (re)appears -- most importantly the moment sendMessage()'s auto-create branch (App.tsx) turns the landing's own composer into a real Workspace's Chat -- carrying focus forward lets the user keep typing without a hiccup. Harmless the other times it remounts (e.g. undocking): a deliberate, infrequent action, not a reveal that happens many times a session. */}
					<Composer draft={draft} onDraftChange={onDraftChange} onComposerFocus={onComposerFocus} autoFocus bare />
				</div>
			)}
		</div>
	);
}
