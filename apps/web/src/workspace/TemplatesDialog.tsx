import * as Dialog from "@radix-ui/react-dialog";
import type { Position } from "dockview-react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Search, SquareStack } from "lucide-react";
import { useState } from "react";
import { DialogCloseButton } from "../commands/DialogCloseButton.js";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "../platform/surface-style.js";
import type { SurfaceTemplateEntry } from "./useSurfaceTemplates.js";

const PLACEMENTS: readonly { position: Position | undefined; label: string; icon: typeof SquareStack }[] = [
	{ position: undefined, label: "As a tab", icon: SquareStack },
	{ position: "top", label: "Split top", icon: ArrowUp },
	{ position: "bottom", label: "Split bottom", icon: ArrowDown },
	{ position: "left", label: "Split left", icon: ArrowLeft },
	{ position: "right", label: "Split right", icon: ArrowRight },
];

interface TemplatesDialogProps {
	readonly open: boolean;
	readonly onClose: () => void;
	readonly entries: readonly SurfaceTemplateEntry[];
	readonly onDock: (templateId: string, title: string, position: Position | undefined) => void;
}

/**
 * Keyboard-native, Linux-window-manager-launcher-style flow for spawning a
 * Surface Template: filter the catalog by keyboard alone, pick one, then
 * choose where it docks -- the same choice a mouse drag onto an edge or a
 * tab strip would make, not a simplified fallback for keyboard users.
 */
export function TemplatesDialog({ open, onClose, entries, onDock }: TemplatesDialogProps): React.JSX.Element {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<SurfaceTemplateEntry | undefined>(undefined);

	function reset(): void {
		setQuery("");
		setSelected(undefined);
	}

	const normalized = query.trim().toLowerCase();
	const filtered = entries.filter((entry) => !normalized || entry.title.toLowerCase().includes(normalized));

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					onClose();
					reset();
				}
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-gray-950/45 backdrop-blur-[1px] data-[state=open]:animate-in" />
				<Dialog.Content
					aria-label="Surface Templates"
					className={cn("fixed left-1/2 top-[14vh] z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 shadow-2xl outline-none dark:border-gray-700", SURFACE_BG)}
				>
					<div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
						<Search aria-hidden="true" size={17} className="text-gray-500" />
						<Dialog.Title className="text-sm font-semibold text-gray-900 dark:text-gray-100">{selected ? `Dock "${selected.title}"` : "Surface Templates"}</Dialog.Title>
						<DialogCloseButton label="Close Surface Templates" />
					</div>
					<Dialog.Description className="sr-only">Filter Surface Templates by keyboard, choose one, then choose where it docks.</Dialog.Description>

					{!selected && (
						<>
							<div className="border-b border-gray-200 p-3 dark:border-gray-700">
								<input
									autoFocus
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									aria-label="Filter Surface Templates"
									placeholder="Type to filter…"
									className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-20 dark:border-gray-600 dark:bg-gray-800 dark:focus:ring-accent-70"
								/>
							</div>
							<div className="max-h-[50vh] overflow-auto p-2">
								{filtered.length === 0 && <p className="px-3 py-4 text-sm text-gray-600 dark:text-gray-300">No Surface Templates match &quot;{query}&quot;.</p>}
								{filtered.map((entry) => (
									<button
										key={entry.id}
										type="button"
										onClick={() => setSelected(entry)}
										className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-gray-800"
									>
										<entry.icon aria-hidden="true" size={16} className="shrink-0 text-gray-600 dark:text-gray-300" />
										<span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">{entry.title}</span>
										{entry.saved && <span className="shrink-0 rounded-full border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-600 dark:border-gray-600 dark:text-gray-300">Saved</span>}
									</button>
								))}
							</div>
						</>
					)}

					{selected && (
						<div className="grid grid-cols-1 gap-1 p-3 sm:grid-cols-2">
							{PLACEMENTS.map((placement) => (
								<button
									key={placement.label}
									type="button"
									onClick={() => {
										onDock(selected.templateId, selected.title, placement.position);
										onClose();
										reset();
									}}
									className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 text-left hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:border-gray-700 dark:hover:bg-gray-800"
								>
									<placement.icon aria-hidden="true" size={16} className="shrink-0 text-gray-600 dark:text-gray-300" />
									<span className="text-sm font-medium text-gray-900 dark:text-gray-100">{placement.label}</span>
								</button>
							))}
						</div>
					)}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
