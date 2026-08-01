import { ChevronsLeft, ChevronsRight, Command, Keyboard, MoonStar, Settings } from "lucide-react";
import type { RefObject } from "react";
import type { ConversationSummary } from "../conversation/client.js";
import { CommandButton, useCommandShortcut } from "../commands/react.js";
import { PillarTooltip } from "./PillarTooltip.js";

interface WorkspaceSelectionProps {
	readonly collapsed: boolean;
	readonly conversations: readonly ConversationSummary[];
	readonly selectedConversationId?: string;
	readonly loading: boolean;
	readonly selectionRef: RefObject<HTMLElement | null>;
	readonly selectedButtonRef: RefObject<HTMLButtonElement | null>;
	readonly onConversationFocus: (conversationId: string) => void;
}

/** The only shell sidebar, for choosing which Workspace (Conversation) is active -- nothing else. Surface docking lives in the Window Carousel/center/Surface Templates pillar instead. */
export function WorkspaceSelection({ collapsed, conversations, selectedConversationId, loading, selectionRef, selectedButtonRef, onConversationFocus }: WorkspaceSelectionProps): React.JSX.Element {
	return (
		<>
			{!collapsed && (
				<nav
					ref={selectionRef}
					aria-label="Workspace selection"
					className="absolute inset-y-0 left-0 z-20 flex h-full w-64 shrink-0 flex-col overflow-hidden rounded-[var(--app-corner-radius,16px)] bg-gray-50 shadow-xl dark:bg-gray-900 md:relative md:shadow-none"
				>
					<div className="flex h-12 items-center gap-2 border-b-[length:var(--app-line-width)] border-gray-200 px-3 dark:border-gray-700">
						<div className="grid size-7 place-items-center rounded-md bg-accent text-xs font-bold text-white">A</div>
						<h1 className="text-sm font-semibold tracking-tight text-gray-950 dark:text-white">Alignment</h1>
						<CommandButton
							commandId="workspace.toggleSelection"
							label="Hide workspace selection"
							className="ml-auto grid size-8 place-items-center rounded-md text-gray-600 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800"
						>
							<ChevronsLeft aria-hidden="true" size={16} />
						</CommandButton>
					</div>
					<div className="border-b-[length:var(--app-line-width)] border-gray-200 px-3 py-2 dark:border-gray-700">
						<p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-600 dark:text-gray-300">Conversations</p>
					</div>
					<ul aria-label="Alef conversations" className="min-h-0 flex-1 overflow-auto p-2">
						{loading && <li><p className="px-2 py-3 text-xs text-gray-600 dark:text-gray-300">Loading…</p></li>}
						{!loading && conversations.length === 0 && <li><p className="px-2 py-3 text-xs text-gray-600 dark:text-gray-300">No local conversations found.</p></li>}
						{conversations.map((conversation) => {
							const selected = conversation.id === selectedConversationId;
							const title = conversation.name ?? `Untitled — ${conversation.latestSessionId}`;
							return (
								<li key={conversation.id}>
									<CommandButton
										ref={selected ? selectedButtonRef : undefined}
										commandId="conversation.open"
										commandArgs={[conversation.id]}
										data-conversation-id={conversation.id}
										onFocus={() => onConversationFocus(conversation.id)}
										label={`${title}, ${conversation.totalTurns} turns`}
										aria-current={selected ? "page" : undefined}
										className={`mb-1 w-full rounded-md px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent ${selected ? "bg-white text-gray-950 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:text-white dark:ring-gray-700" : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800/70"}`}
									>
										<span className="block truncate text-xs font-medium">{title}</span>
										<span className="mt-0.5 flex gap-2 text-[10px] text-gray-600 dark:text-gray-300">
											<span>{conversation.totalTurns} turns</span>
											<span>{relativeTime(conversation.lastActiveAt)}</span>
										</span>
									</CommandButton>
								</li>
							);
						})}
					</ul>
					<div className="grid grid-cols-4 gap-1 border-t-[length:var(--app-line-width)] border-gray-200 p-2 dark:border-gray-700">
						<FooterCommand commandId="palette.open" label="Command palette" icon={<Command aria-hidden="true" size={15} />} />
						<FooterCommand commandId="shortcuts.open" label="Keyboard shortcuts" icon={<Keyboard aria-hidden="true" size={15} />} />
						<FooterCommand commandId="theme.cycle" label="Cycle color theme" icon={<MoonStar aria-hidden="true" size={15} />} />
						<FooterCommand commandId="appearance.open" label="Visual DNA" icon={<Settings aria-hidden="true" size={15} />} />
					</div>
				</nav>
			)}
			{collapsed && (
				<nav aria-label="Workspace quick selection" className="relative z-20 flex h-full w-14 shrink-0 flex-col overflow-hidden rounded-[var(--app-corner-radius,16px)] bg-gray-50 dark:bg-gray-900">
					<CollapsedToggle />
					<div className="flex flex-1 flex-col items-center gap-1 overflow-auto py-2">
						{conversations.map((conversation) => {
							const selected = conversation.id === selectedConversationId;
							const title = conversation.name ?? `Untitled — ${conversation.latestSessionId}`;
							const initial = title.trim().charAt(0).toUpperCase() || "?";
							return (
								<div key={conversation.id} className="group relative">
									<CommandButton
										ref={selected ? selectedButtonRef : undefined}
										commandId="conversation.open"
										commandArgs={[conversation.id]}
										data-conversation-id={conversation.id}
										onFocus={() => onConversationFocus(conversation.id)}
										label={title}
										tooltip={false}
										aria-current={selected ? "page" : undefined}
										className={`grid size-9 place-items-center rounded-md text-xs font-semibold focus-visible:outline-2 focus-visible:outline-accent ${selected ? "bg-accent-10 text-accent-60 dark:bg-accent-80 dark:text-accent-30" : "text-gray-600 hover:bg-gray-200 hover:text-gray-950 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"}`}
									>
										{initial}
									</CommandButton>
									<PillarTooltip side="right" label={title} />
								</div>
							);
						})}
					</div>
					<div className="flex flex-col items-center gap-1 border-t-[length:var(--app-line-width)] border-gray-200 py-2 dark:border-gray-700">
						<PillarCommand commandId="palette.open" label="Command palette" icon={<Command aria-hidden="true" size={16} />} />
						<PillarCommand commandId="shortcuts.open" label="Keyboard shortcuts" icon={<Keyboard aria-hidden="true" size={16} />} />
						<PillarCommand commandId="theme.cycle" label="Color theme" icon={<MoonStar aria-hidden="true" size={16} />} />
						<PillarCommand commandId="appearance.open" label="Visual DNA" icon={<Settings aria-hidden="true" size={16} />} />
					</div>
				</nav>
			)}
		</>
	);
}

function CollapsedToggle(): React.JSX.Element {
	const label = "Expand workspace selection";
	const shortcut = useCommandShortcut("workspace.toggleSelection");
	return (
		<div className="group relative shrink-0">
			<CommandButton
				commandId="workspace.toggleSelection"
				label={label}
				tooltip={false}
				className="grid h-12 w-14 place-items-center border-b-[length:var(--app-line-width)] border-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:border-gray-700"
			>
				<span className="relative grid size-7 place-items-center rounded-md bg-accent text-white">
					<span aria-hidden="true" className="text-xs font-bold transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">A</span>
					<ChevronsRight aria-hidden="true" size={16} className="absolute opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
				</span>
			</CommandButton>
			<PillarTooltip side="right" label={label} shortcut={shortcut} />
		</div>
	);
}

function PillarCommand({ commandId, label, icon }: { readonly commandId: string; readonly label: string; readonly icon: React.ReactNode }): React.JSX.Element {
	const shortcut = useCommandShortcut(commandId);
	return (
		<div className="group relative">
			<CommandButton commandId={commandId} label={label} tooltip={false} className="grid size-9 place-items-center rounded-md text-gray-600 hover:bg-gray-200 hover:text-gray-950 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white">
				{icon}
			</CommandButton>
			<PillarTooltip side="right" label={label} shortcut={shortcut} />
		</div>
	);
}

function FooterCommand({ commandId, label, icon }: { readonly commandId: string; readonly label: string; readonly icon: React.ReactNode }): React.JSX.Element {
	return (
		<CommandButton
			commandId={commandId}
			label={label}
			className="grid h-8 place-items-center rounded-md text-gray-600 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800"
		>
			{icon}
		</CommandButton>
	);
}

function relativeTime(iso: string): string {
	const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}
