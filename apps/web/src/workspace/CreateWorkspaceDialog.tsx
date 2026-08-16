import * as Dialog from "@radix-ui/react-dialog";
import { DialogChrome, glyphBadgeClassName } from "@zodiac/ui";
import { useState } from "react";
import { DEFAULT_WORKSPACE_GLYPH_ID, WORKSPACE_GLYPH_OPTIONS } from "./workspace-catalog.js";

interface CreateWorkspaceDialogProps {
	readonly open: boolean;
	readonly onClose: () => void;
	readonly onCreate: (title: string, glyphId: string) => void;
}

/** Reached from the "+" frame below the last Workspace (WorkspaceSelection.tsx) -- names and picks a glyph for a brand-new Workspace, persisted via useUserWorkspaces. */
export function CreateWorkspaceDialog({ open, onClose, onCreate }: CreateWorkspaceDialogProps): React.JSX.Element {
	const [title, setTitle] = useState("");
	const [glyphId, setGlyphId] = useState(DEFAULT_WORKSPACE_GLYPH_ID);

	return (
		<DialogChrome
			variant="dialog"
			open={open}
			width={360}
			topOffsetVh={20}
			ariaLabel="New Workspace"
			onOpenChange={(next) => {
				if (!next) onClose();
				else {
					setTitle("");
					setGlyphId(DEFAULT_WORKSPACE_GLYPH_ID);
				}
			}}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (title.trim()) onCreate(title, glyphId);
				}}
			>
				<div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
					<Dialog.Title className="text-sm font-semibold text-gray-900 dark:text-gray-100">New Workspace</Dialog.Title>
				</div>
				<Dialog.Description className="sr-only">Name a new Workspace and pick a glyph for it.</Dialog.Description>
				<div className="flex flex-col gap-3 p-4">
					<input
						autoFocus
						aria-label="Workspace title"
						placeholder="Workspace title"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-20 dark:border-gray-600 dark:bg-gray-800"
					/>
					<div role="radiogroup" aria-label="Glyph" className="grid grid-cols-8 gap-1.5">
						{Object.entries(WORKSPACE_GLYPH_OPTIONS).map(([id, Icon]) => (
							<button
								key={id}
								type="button"
								role="radio"
								aria-checked={glyphId === id}
								aria-label={id}
								onClick={() => setGlyphId(id)}
								className={glyphBadgeClassName({ active: glyphId === id, size: "xl" })}
							>
								<Icon aria-hidden="true" size={16} />
							</button>
						))}
					</div>
					<div className="flex justify-end gap-2">
						<Dialog.Close asChild>
							<button type="button" className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800">
								Cancel
							</button>
						</Dialog.Close>
						<button type="submit" disabled={!title.trim()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-60 disabled:cursor-not-allowed disabled:opacity-45">
							Create
						</button>
					</div>
				</div>
			</form>
		</DialogChrome>
	);
}
