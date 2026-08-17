import { ChevronsLeft, ChevronsRight, Command, Keyboard, MoonStar, Plus, Settings, X } from "lucide-react";
import { useState, type RefObject } from "react";
import { CommandButton, useCommandShortcut } from "../commands/react.js";
import { cn } from "../platform/cn.js";
import { ConfirmDialog, glyphBadgeClassName, GlyphBadge, iconButtonClassName, SURFACE_BG, UserAvatar } from "@zodiac/ui";
import { PillarCap } from "./PillarCap.js";
import { PillarTooltip } from "./PillarTooltip.js";
import type { WorkspaceCatalogEntry } from "./workspace-catalog.js";

interface WorkspaceSelectionProps {
	readonly collapsed: boolean;
	readonly catalog: readonly WorkspaceCatalogEntry[];
	/** Undefined when there is no active Workspace yet (a genuinely empty catalog) -- every catalog entry then simply renders unselected. */
	readonly activeWorkspaceId: string | undefined;
	readonly selectionRef: RefObject<HTMLElement | null>;
	readonly selectedButtonRef: RefObject<HTMLButtonElement | null>;
	readonly onWorkspaceFocus: () => void;
	/** Real tool-call telemetry says the agent is currently acting against this Workspace, and Chat is global (undocked) -- see "Global chat: cross-workspace visibility cue". Undefined most of the time. */
	readonly toolCallWorkspaceId?: string;
	readonly onCreateWorkspace: () => void;
	/** Renames a catalog entry by id -- reachable by double-clicking its label in the expanded pillar (see ExpandedCatalogItem). Not exposed in the collapsed pillar, which shows no text label to double-click. */
	readonly onWorkspaceRename: (id: string, title: string) => void;
	/** Permanently drops a catalog entry (and every Window/docked Surface it owns) by id -- reached via each expanded row's own Close button, gated behind a confirmation (see ExpandedCatalogItem/ConfirmDialog below). Not yet exposed in the collapsed pillar -- see its own doc comment. */
	readonly onWorkspaceRemove: (id: string) => void;
}

/**
 * The only shell sidebar, for choosing which Workspace is active -- nothing
 * else. A Workspace is its own independent Canvas (Windows, docked
 * Surfaces), never a Conversation: a Conversation is a Surface that may be
 * global (always visible) or dock into one (see ChatPanel/workspace/model.ts's
 * dockChat) -- it never appears in this list. Surface docking itself lives
 * in the Window Carousel/center/Surface Templates pillar instead.
 */
export function WorkspaceSelection({ collapsed, catalog, activeWorkspaceId, selectionRef, selectedButtonRef, onWorkspaceFocus, toolCallWorkspaceId, onCreateWorkspace, onWorkspaceRename, onWorkspaceRemove }: WorkspaceSelectionProps): React.JSX.Element {
	const appearanceShortcut = useCommandShortcut("appearance.open");
	// The entry a Close click is asking to remove, pending the user's actual
	// confirmation -- undefined the rest of the time, including right after a
	// confirm/cancel decides it one way or the other.
	const [pendingRemoval, setPendingRemoval] = useState<WorkspaceCatalogEntry | undefined>(undefined);
	return (
		<>
			{!collapsed && (
				<nav
					ref={selectionRef}
					aria-label="Workspace selection"
					className={cn("absolute inset-y-0 left-0 z-20 flex h-full w-64 shrink-0 flex-col overflow-hidden rounded-[var(--app-corner-radius,16px)] shadow-xl md:relative md:shadow-none", SURFACE_BG)}
				>
					<div className="flex h-12 items-center gap-2 border-b-[length:var(--app-line-width)] border-gray-200 px-3 dark:border-gray-700">
						{/* The header's own logo lockup (identity mark + wordmark) -- see UserAvatar.tsx for why this is always a true circle, never the shared --app-corner-radius token every other shape here follows. */}
						<UserAvatar size="md" />
						<h1 className="text-sm font-semibold tracking-tight text-gray-950 dark:text-white">Zodiac</h1>
						<CommandButton commandId="workspace.toggleSelection" label="Hide workspace selection" className={cn("ml-auto", iconButtonClassName({ size: "xl" }))}>
							<ChevronsLeft aria-hidden="true" size={16} />
						</CommandButton>
					</div>
					<div className="flex min-h-0 flex-1 flex-col">
						<ul aria-label="Workspaces" className="overflow-auto p-2">
							{catalog.map((entry) => (
								<ExpandedCatalogItem
									key={entry.id}
									entry={entry}
									selected={entry.id === activeWorkspaceId}
									toolCallTarget={entry.id === toolCallWorkspaceId}
									selectedButtonRef={selectedButtonRef}
									onWorkspaceFocus={onWorkspaceFocus}
									onRename={(title) => onWorkspaceRename(entry.id, title)}
									onRequestClose={() => setPendingRemoval(entry)}
								/>
							))}
						</ul>
						{/* Fills the whole remaining empty space below the list -- hovering anywhere in it (not just the visible dashed frame) reveals "New Workspace". */}
						<button
							type="button"
							onClick={onCreateWorkspace}
							aria-label="Create a new Workspace"
							className="m-2 flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-dashed border-transparent text-xs text-gray-400 opacity-0 transition-opacity hover:border-gray-300 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-500 dark:hover:border-gray-600"
						>
							<Plus aria-hidden="true" size={14} />
							New Workspace
						</button>
					</div>
					{/* Expanded keeps every action as its own icon -- only the collapsed pillar folds these under one Settings entry. */}
					<div className="grid grid-cols-4 gap-1 border-t-[length:var(--app-line-width)] border-gray-200 p-2 dark:border-gray-700">
						<FooterCommand commandId="palette.open" label="Command palette" icon={<Command aria-hidden="true" size={15} />} />
						<FooterCommand commandId="shortcuts.open" label="Keyboard shortcuts" icon={<Keyboard aria-hidden="true" size={15} />} />
						<FooterCommand commandId="theme.cycle" label="Cycle color theme" icon={<MoonStar aria-hidden="true" size={15} />} />
						<FooterCommand commandId="appearance.open" label="Settings" icon={<Settings aria-hidden="true" size={15} />} />
					</div>
				</nav>
			)}
			{/* Pillar Cap: the shared --app-corner-radius token, same as everywhere else -- CSS's own per-corner clamping (radius capped at half the box's own side) turns this narrow, tall nav into a true stadium once Corner Sharpness pushes the radius past half its width, exactly how a size-9 glyph button already becomes a circle at max sharpness. Never a fixed rounded-full: that would stay circular even at Corner Sharpness 0. */}
			{collapsed && (
				<nav aria-label="Workspace quick selection" className={cn("relative z-20 flex h-full w-14 shrink-0 flex-col overflow-hidden rounded-[var(--app-corner-radius,16px)]", SURFACE_BG)}>
					<CollapsedToggle />
					{/* The "+" lives inside this same flex column, right after the last Workspace glyph -- not a sibling pinned near the footer by the column's own flex-1 growth. */}
					<div className="flex flex-1 flex-col items-center gap-1 overflow-auto py-2">
						{catalog.map((entry) => (
							<CollapsedCatalogItem
								key={entry.id}
								entry={entry}
								selected={entry.id === activeWorkspaceId}
								toolCallTarget={entry.id === toolCallWorkspaceId}
								selectedButtonRef={selectedButtonRef}
								onWorkspaceFocus={onWorkspaceFocus}
							/>
						))}
						<PillarTooltip side="right" label="Create a new Workspace">
							<button type="button" onClick={onCreateWorkspace} aria-label="Create a new Workspace" className={iconButtonClassName({ size: "lg", dashed: true })}>
								<Plus aria-hidden="true" size={16} />
							</button>
						</PillarTooltip>
					</div>
					{/* Command palette/shortcuts/theme fold into the one Settings entry (its own dialog exposes all three as rows) -- the collapsed pillar has no room for four separate icons. */}
					<PillarTooltip side="right" label="Settings" shortcut={appearanceShortcut}>
						<PillarCap commandId="appearance.open" label="Settings" slot="end">
							<Settings aria-hidden="true" size={16} />
						</PillarCap>
					</PillarTooltip>
				</nav>
			)}
			<ConfirmDialog
				open={pendingRemoval !== undefined}
				title={`Close ${pendingRemoval?.title ?? ""}?`}
				description="Every Window and docked Surface in it is discarded. This can't be undone."
				confirmLabel="Close Workspace"
				onConfirm={() => {
					if (pendingRemoval) onWorkspaceRemove(pendingRemoval.id);
					setPendingRemoval(undefined);
				}}
				onCancel={() => setPendingRemoval(undefined)}
			/>
		</>
	);
}

function CollapsedToggle(): React.JSX.Element {
	const label = "Expand workspace selection";
	const shortcut = useCommandShortcut("workspace.toggleSelection");
	return (
		<PillarTooltip side="right" label={label} shortcut={shortcut}>
			<PillarCap commandId="workspace.toggleSelection" label={label} slot="start">
				<span className="relative grid place-items-center">
					<UserAvatar size="lg" className="transition-opacity group-hover:opacity-0 group-focus-within:opacity-0" />
					<ChevronsRight aria-hidden="true" size={18} className="absolute opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
				</span>
			</PillarCap>
		</PillarTooltip>
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

interface CatalogItemProps {
	readonly entry: WorkspaceCatalogEntry;
	readonly selected: boolean;
	/** A real tool call is currently acting against this Workspace while Chat is global -- see WorkspaceSelectionProps.toolCallWorkspaceId. */
	readonly toolCallTarget: boolean;
	readonly selectedButtonRef: RefObject<HTMLButtonElement | null>;
	readonly onWorkspaceFocus: () => void;
}

/** One Workspace's row in the expanded pillar -- its own component so the expanded/collapsed variants (below) each state their own layout once, instead of an inline ternary className repeated at every map callsite. Double-clicking the label enters an inline rename -- Enter commits, Escape or a blank blur cancels back to the entry's current title (never sends a blank rename -- see useUserWorkspaces/useWorkspaceRegistry's own blank-title guard). */
function ExpandedCatalogItem({ entry, selected, toolCallTarget, selectedButtonRef, onWorkspaceFocus, onRename, onRequestClose }: CatalogItemProps & { readonly onRename: (title: string) => void; readonly onRequestClose: () => void }): React.JSX.Element {
	const [renaming, setRenaming] = useState(false);
	const [draft, setDraft] = useState(entry.title);

	function commit(): void {
		const trimmed = draft.trim();
		setRenaming(false);
		if (trimmed && trimmed !== entry.title) onRename(trimmed);
	}

	function cancel(): void {
		setDraft(entry.title);
		setRenaming(false);
	}

	return (
		<li className="group relative">
			<CommandButton
				ref={selected ? selectedButtonRef : undefined}
				commandId="workspace.select"
				commandArgs={[entry.id]}
				data-workspace-catalog-id={entry.id}
				onFocus={onWorkspaceFocus}
				onDoubleClick={(event) => {
					event.preventDefault();
					setDraft(entry.title);
					setRenaming(true);
				}}
				label={entry.title}
				aria-current={selected ? "page" : undefined}
				className={cn(
					"mb-1 flex w-full items-center gap-2.5 rounded-md py-2 pl-2.5 pr-8 text-left focus-visible:outline-2 focus-visible:outline-accent motion-reduce:animate-none hover:animate-wisp-breathe focus-visible:animate-wisp-breathe",
					selected ? "animate-wisp-breathe bg-white text-gray-950 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:text-white dark:ring-gray-700" : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800/70",
					toolCallTarget && "animate-wisp-breathe ring-2 ring-accent",
				)}
			>
				<GlyphBadge active={selected} size="sm">
					<entry.icon aria-hidden="true" size={13} />
				</GlyphBadge>
				{renaming ? (
					<input
						autoFocus
						aria-label={`Rename ${entry.title}`}
						value={draft}
						onClick={(event) => event.stopPropagation()}
						onChange={(event) => setDraft(event.target.value)}
						onBlur={commit}
						onKeyDown={(event) => {
							event.stopPropagation();
							if (event.key === "Enter") commit();
							else if (event.key === "Escape") cancel();
						}}
						className="w-full truncate rounded border border-accent bg-white px-1 py-0.5 text-xs font-medium text-gray-950 outline-none dark:bg-gray-800 dark:text-white"
					/>
				) : (
					<span className="truncate text-xs font-medium">{entry.title}</span>
				)}
			</CommandButton>
			{/* A sibling of CommandButton, not nested inside it -- overlaid on the row's own right edge (pr-8 above reserves the room), revealed on hover/focus so an idle list stays uncluttered. */}
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onRequestClose();
				}}
				aria-label={`Close ${entry.title}`}
				className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-gray-400 opacity-0 transition-opacity hover:bg-gray-200 hover:text-gray-700 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent group-hover:opacity-100 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
			>
				<X aria-hidden="true" size={13} />
			</button>
		</li>
	);
}

/** One Workspace's glyph in the collapsed pillar -- same catalog entry as ExpandedCatalogItem, laid out as a tooltipped square glyph instead of a labeled row. */
function CollapsedCatalogItem({ entry, selected, toolCallTarget, selectedButtonRef, onWorkspaceFocus }: CatalogItemProps): React.JSX.Element {
	return (
		<PillarTooltip side="right" label={entry.title}>
			<CommandButton
				ref={selected ? selectedButtonRef : undefined}
				commandId="workspace.select"
				commandArgs={[entry.id]}
				data-workspace-catalog-id={entry.id}
				onFocus={onWorkspaceFocus}
				label={entry.title}
				tooltip={false}
				aria-current={selected ? "page" : undefined}
				className={cn(
					glyphBadgeClassName({ active: selected, ring: toolCallTarget, size: "lg" }),
					"focus-visible:outline-2 focus-visible:outline-accent motion-reduce:animate-none hover:animate-wisp-breathe focus-visible:animate-wisp-breathe",
					(selected || toolCallTarget) && "animate-wisp-breathe",
					!selected && "hover:bg-gray-100 hover:text-gray-950 dark:hover:bg-gray-700 dark:hover:text-white",
				)}
			>
				<entry.icon aria-hidden="true" size={18} />
			</CommandButton>
		</PillarTooltip>
	);
}
