import { Activity, MessageSquareText } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { ConversationSurface } from "../conversation/ConversationSurface.js";
import type { ConversationItem } from "../conversation/projector.js";
import { ActivitySurfaceContent } from "./ActivitySurface.js";
import { ACTIVITY_SURFACE_ID, CONVERSATION_SURFACE_ID } from "./model.js";

export interface ChatSurfaceRenderContext {
	conversationItems: readonly ConversationItem[];
	conversationLoading: boolean;
	conversationError?: string;
	draft: string;
	onDraftChange: (value: string) => void;
	onComposerFocus: () => void;
}

export interface ChatSurfaceIconProps {
	"aria-hidden"?: boolean | "true" | "false";
	size?: number;
}

/**
 * One registered child surface of the Chat root surface. Everything a
 * consumer needs to render its tab trigger, its collapsed quick-selection
 * glyph, its command, and its default binding lives on this definition --
 * adding a surface means adding an entry here, not editing WorkspaceCanvas,
 * WorkspaceSelection, or commands/defaults.ts.
 */
export interface ChatSurfaceDefinition {
	id: string;
	title: string;
	icon: ComponentType<ChatSurfaceIconProps>;
	showCommandId: string;
	showCommandTitle: string;
	showCommandDescription: string;
	/** Global binding that cycles directly to this surface, if any. */
	cycleKeys?: string;
	render: (context: ChatSurfaceRenderContext) => ReactNode;
}

export const CHAT_SURFACE_REGISTRY: readonly ChatSurfaceDefinition[] = [
	{
		id: CONVERSATION_SURFACE_ID,
		title: "Conversation",
		icon: MessageSquareText,
		showCommandId: "surface.showConversation",
		showCommandTitle: "Show Conversation",
		showCommandDescription: "Activate the Conversation child surface.",
		cycleKeys: "Mod+Shift+[",
		render: (context) => (
			<ConversationSurface
				items={context.conversationItems}
				loading={context.conversationLoading}
				error={context.conversationError}
				draft={context.draft}
				onDraftChange={context.onDraftChange}
				onComposerFocus={context.onComposerFocus}
			/>
		),
	},
	{
		id: ACTIVITY_SURFACE_ID,
		title: "Activity",
		icon: Activity,
		showCommandId: "surface.showActivity",
		showCommandTitle: "Show Activity",
		showCommandDescription: "Activate the Activity child surface.",
		cycleKeys: "Mod+Shift+]",
		render: () => <ActivitySurfaceContent />,
	},
];

export function defaultChatSurfaceId(): string {
	const [first] = CHAT_SURFACE_REGISTRY;
	if (!first) throw new Error("Chat surface registry must define at least one surface");
	return first.id;
}
