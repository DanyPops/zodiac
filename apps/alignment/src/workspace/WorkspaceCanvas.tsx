import * as Tabs from "@radix-ui/react-tabs";
import type { RefObject } from "react";
import { CommandButton } from "../commands/react.js";
import type { ConversationItem } from "../conversation/projector.js";
import { CHAT_SURFACE_REGISTRY, type ChatSurfaceRenderContext } from "./chat-surface-registry.js";

interface WorkspaceCanvasProps {
	readonly canvasRef: RefObject<HTMLElement | null>;
	readonly activeTab: string;
	readonly onActiveTabChange: (tab: string) => void;
	readonly conversationItems: readonly ConversationItem[];
	readonly conversationLoading: boolean;
	readonly conversationError?: string;
	readonly draft: string;
	readonly onDraftChange: (value: string) => void;
	readonly onComposerFocus: () => void;
	readonly onCanvasFocus: () => void;
}

export function WorkspaceCanvas({
	canvasRef,
	activeTab,
	onActiveTabChange,
	conversationItems,
	conversationLoading,
	conversationError,
	draft,
	onDraftChange,
	onComposerFocus,
	onCanvasFocus,
}: WorkspaceCanvasProps): React.JSX.Element {
	const renderContext: ChatSurfaceRenderContext = {
		conversationItems,
		conversationLoading,
		conversationError,
		draft,
		onDraftChange,
		onComposerFocus,
	};

	return (
		<main aria-label="Workspace canvas" className="min-w-0 flex-1 bg-gray-100 p-3 dark:bg-gray-950">
			<section
				ref={canvasRef}
				tabIndex={-1}
				onFocus={(event) => {
					if (event.currentTarget === event.target) onCanvasFocus();
				}}
				aria-label="Chat surface"
				className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-gray-300 bg-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-accent dark:border-gray-700 dark:bg-gray-900"
			>
				<div className="flex h-11 shrink-0 items-center gap-3 border-b border-gray-200 px-3 dark:border-gray-700">
					<div className="flex min-w-0 items-baseline gap-2">
						<h2 className="truncate text-sm font-semibold text-gray-950 dark:text-white">Chat</h2>
						<span className="text-[11px] text-gray-600 dark:text-gray-300">Workspace Surface</span>
					</div>
					<span className="ml-auto rounded-full border border-success-50 bg-success-10 px-2 py-0.5 text-[10px] font-semibold text-success-80">FRESH</span>
				</div>
				<Tabs.Root value={activeTab} onValueChange={onActiveTabChange} className="flex min-h-0 flex-1 flex-col">
					<Tabs.List aria-label="Chat surface views" className="flex h-10 shrink-0 items-end gap-1 border-b border-gray-200 bg-gray-50 px-2 dark:border-gray-700 dark:bg-gray-900">
						{CHAT_SURFACE_REGISTRY.map((surface) => (
							<Tabs.Trigger key={surface.id} value={surface.id} asChild>
								<CommandButton
									commandId={surface.showCommandId}
									label={surface.title}
									className="flex h-9 items-center gap-2 border-b-2 border-transparent px-3 text-xs font-medium text-gray-600 hover:text-gray-950 focus-visible:outline-2 focus-visible:outline-accent data-[state=active]:border-accent data-[state=active]:text-gray-950 dark:text-gray-300 dark:hover:text-white dark:data-[state=active]:text-white"
								>
									<surface.icon aria-hidden="true" size={14} />
									{surface.title}
								</CommandButton>
							</Tabs.Trigger>
						))}
					</Tabs.List>
					{CHAT_SURFACE_REGISTRY.map((surface) => (
						<Tabs.Content key={surface.id} value={surface.id} className="min-h-0 flex-1 outline-none">
							{surface.render(renderContext)}
						</Tabs.Content>
					))}
				</Tabs.Root>
			</section>
		</main>
	);
}
