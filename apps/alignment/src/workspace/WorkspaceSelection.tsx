import { ChevronsLeft, ChevronsRight, Command, Keyboard, MoonStar, Plus, Settings } from "lucide-react";
import type { RefObject } from "react";
import { CommandButton, useCommandShortcut } from "../commands/react.js";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "../platform/surface-style.js";
import { GlyphBadge } from "./GlyphBadge.js";
import { glyphBadgeClassName } from "./glyph-badge-style.js";
import { PillarTooltip } from "./PillarTooltip.js";
import type { WorkspaceCatalogEntry } from "./workspace-catalog.js";

interface WorkspaceSelectionProps {
	readonly collapsed: boolean;
	readonly catalog: readonly WorkspaceCatalogEntry[];
	readonly activeWorkspaceId: string;
	readonly selectionRef: RefObject<HTMLElement | null>;
	readonly selectedButtonRef: RefObject<HTMLButtonElement | null>;
	readonly onWorkspaceFocus: () => void;
	/** Real tool-call telemetry says the agent is currently acting against this Workspace, and Chat is global (undocked) -- see "Global chat: cross-workspace visibility cue". Undefined most of the time. */
	readonly toolCallWorkspaceId?: string;
	readonly onCreateWorkspace: () => void;
}

/**
 * The only shell sidebar, for choosing which Workspace is active -- nothing
 * else. A Workspace is its own independent Canvas (Windows, docked
 * Surfaces, Chat visibility), never a Conversation: a Conversation is a
 * Surface that may float globally, float inside a Workspace, or dock into
 * one (see ChatOverlay/workspace/model.ts's dockChat) -- it never appears
 * in this list. Surface docking itself lives in the Window Carousel/center/
 * Surface Templates pillar instead.
 */
export function WorkspaceSelection({ collapsed, catalog, activeWorkspaceId, selectionRef, selectedButtonRef, onWorkspaceFocus, toolCallWorkspaceId, onCreateWorkspace }: WorkspaceSelectionProps): React.JSX.Element {
	return (
		<>
			{!collapsed && (
				<nav
					ref={selectionRef}
					aria-label="Workspace selection"
					className={cn("absolute inset-y-0 left-0 z-20 flex h-full w-64 shrink-0 flex-col overflow-hidden rounded-[var(--app-corner-radius,16px)] shadow-xl md:relative md:shadow-none", SURFACE_BG)}
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
						<p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-600 dark:text-gray-300">Workspaces</p>
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
			{/* Pillar Cap: rounded-full, not the shared corner-radius token -- a Pillar is always a stadium/pill shape at its own top and bottom, independent of the Corner Sharpness setting elsewhere. */}
			{collapsed && (
				<nav aria-label="Workspace quick selection" className={cn("relative z-20 flex h-full w-14 shrink-0 flex-col overflow-hidden rounded-full", SURFACE_BG)}>
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
							<button
								type="button"
								onClick={onCreateWorkspace}
								aria-label="Create a new Workspace"
								className="grid size-9 shrink-0 place-items-center rounded-md border border-dashed border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600 focus-visible:outline-2 focus-visible:outline-accent dark:border-gray-600 dark:hover:border-gray-500 dark:hover:text-gray-300"
							>
								<Plus aria-hidden="true" size={16} />
							</button>
						</PillarTooltip>
					</div>
					{/* Command palette/shortcuts/theme fold into the one Settings entry (its own dialog exposes all three as rows) -- the collapsed pillar has no room for four separate icons. */}
					<div className="flex flex-col items-center gap-1 border-t-[length:var(--app-line-width)] border-gray-200 py-2 dark:border-gray-700">
						<PillarCommand commandId="appearance.open" label="Settings" icon={<Settings aria-hidden="true" size={16} />} />
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
		<PillarTooltip side="right" label={label} shortcut={shortcut}>
			<CommandButton
				commandId="workspace.toggleSelection"
				label={label}
				tooltip={false}
				className="group grid h-12 w-14 shrink-0 place-items-center border-b-[length:var(--app-line-width)] border-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:border-gray-700"
			>
				<span className="relative grid size-7 place-items-center rounded-md bg-accent text-white">
					<span aria-hidden="true" className="text-xs font-bold transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">A</span>
					<ChevronsRight aria-hidden="true" size={16} className="absolute opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
				</span>
			</CommandButton>
		</PillarTooltip>
	);
}

function PillarCommand({ commandId, label, icon }: { readonly commandId: string; readonly label: string; readonly icon: React.ReactNode }): React.JSX.Element {
	const shortcut = useCommandShortcut(commandId);
	return (
		<PillarTooltip side="right" label={label} shortcut={shortcut}>
			<CommandButton commandId={commandId} label={label} tooltip={false} className="grid size-9 place-items-center rounded-md text-gray-600 hover:bg-gray-200 hover:text-gray-950 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white">
				{icon}
			</CommandButton>
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

/** One Workspace's row in the expanded pillar -- its own component so the expanded/collapsed variants (below) each state their own layout once, instead of an inline ternary className repeated at every map callsite. */
function ExpandedCatalogItem({ entry, selected, toolCallTarget, selectedButtonRef, onWorkspaceFocus }: CatalogItemProps): React.JSX.Element {
	return (
		<li>
			<CommandButton
				ref={selected ? selectedButtonRef : undefined}
				commandId="workspace.select"
				commandArgs={[entry.id]}
				data-workspace-catalog-id={entry.id}
				onFocus={onWorkspaceFocus}
				label={entry.title}
				aria-current={selected ? "page" : undefined}
				className={cn(
					"mb-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent motion-reduce:animate-none hover:animate-wisp-breathe focus-visible:animate-wisp-breathe",
					selected ? "animate-wisp-breathe bg-white text-gray-950 shadow-sm ring-1 ring-gray-200 dark:bg-gray-800 dark:text-white dark:ring-gray-700" : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800/70",
					toolCallTarget && "animate-wisp-breathe ring-2 ring-accent",
				)}
			>
				<GlyphBadge active={selected} size="sm">
					<entry.icon aria-hidden="true" size={13} />
				</GlyphBadge>
				<span className="truncate text-xs font-medium">{entry.title}</span>
			</CommandButton>
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
