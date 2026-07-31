import { Plus } from "lucide-react";
import { useState } from "react";
import { CommandButton, useCommandShortcut } from "../commands/react.js";
import { PillarTooltip } from "./PillarTooltip.js";
import { TEMPLATE_DRAG_MIME_TYPE } from "./drag-constants.js";
import type { SurfaceTemplateEntry } from "./useSurfaceTemplates.js";

interface SurfaceTemplatesPillarProps {
	readonly entries: readonly SurfaceTemplateEntry[];
	/** Click or Enter on a glyph: dock immediately with the docking engine's own default placement (a new tab). Dragging a glyph, or the `templates.open` command, offers full placement choice instead. */
	readonly onDockDefault: (templateId: string, title: string) => void;
	readonly canSaveCurrent: boolean;
	readonly onSaveCurrentAsTemplate: (title: string) => void;
}

/**
 * The Surface Templates pillar: mirrors Workspace Selection's glyph-pillar
 * pattern on the opposite edge. Holds the predefined catalog plus user-saved
 * templates; pulling one to the center docks it.
 */
export function SurfaceTemplatesPillar({ entries, onDockDefault, canSaveCurrent, onSaveCurrentAsTemplate }: SurfaceTemplatesPillarProps): React.JSX.Element {
	const [savingTitle, setSavingTitle] = useState<string | null>(null);
	const openPickerShortcut = useCommandShortcut("templates.open");

	return (
		<nav aria-label="Surface Templates" className="relative z-20 flex h-full w-14 shrink-0 flex-col overflow-hidden rounded-2xl bg-gray-50 dark:bg-gray-900">
			<div className="group relative shrink-0 border-b border-gray-200 dark:border-gray-700">
				<CommandButton commandId="templates.open" label="Browse Surface Templates" tooltip={false} className="grid h-12 w-14 place-items-center text-gray-600 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800">
					<Plus aria-hidden="true" size={18} />
				</CommandButton>
				<PillarTooltip side="left" label="Browse Surface Templates" shortcut={openPickerShortcut} />
			</div>

			<div className="flex flex-1 flex-col items-center gap-1 overflow-auto py-2">
				{entries.map((entry) => (
					<div key={entry.id} className="group relative">
						<button
							type="button"
							draggable
							onDragStart={(event) => event.dataTransfer.setData(TEMPLATE_DRAG_MIME_TYPE, entry.templateId)}
							onClick={() => onDockDefault(entry.templateId, entry.title)}
							aria-label={`Dock ${entry.title}`}
							className="grid size-9 place-items-center rounded-md text-gray-600 hover:bg-gray-200 hover:text-gray-950 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
						>
							<entry.icon aria-hidden="true" size={17} />
						</button>
						<PillarTooltip side="left" label={entry.saved ? `${entry.title} (saved)` : entry.title} />
					</div>
				))}
			</div>

			<div className="flex flex-col items-center gap-1 border-t border-gray-200 p-2 dark:border-gray-700">
				{savingTitle === null && (
					<div className="group relative">
						<button
							type="button"
							disabled={!canSaveCurrent}
							onClick={() => setSavingTitle("")}
							aria-label="Save the active docked Surface as a new template"
							className="grid size-9 place-items-center rounded-md text-gray-600 hover:bg-gray-200 hover:text-gray-950 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
						>
							<span aria-hidden="true" className="text-sm font-semibold">+T</span>
						</button>
						{canSaveCurrent && <PillarTooltip side="left" label="Save active Surface as a template" />}
					</div>
				)}
				{savingTitle !== null && (
					<form
						className="flex w-12 flex-col gap-1"
						onSubmit={(event) => {
							event.preventDefault();
							if (savingTitle.trim()) onSaveCurrentAsTemplate(savingTitle);
							setSavingTitle(null);
						}}
					>
						<input
							autoFocus
							aria-label="New template title"
							value={savingTitle}
							onChange={(event) => setSavingTitle(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") setSavingTitle(null);
							}}
							className="w-full rounded border border-gray-300 bg-white px-1 py-1 text-[10px] outline-none focus:border-accent focus:ring-1 focus:ring-accent-20 dark:border-gray-600 dark:bg-gray-800"
						/>
						<button type="submit" className="rounded bg-accent px-1 py-0.5 text-[10px] font-medium text-white hover:bg-accent-60">
							Save
						</button>
					</form>
				)}
			</div>
		</nav>
	);
}
