import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { cn } from "../platform/cn.js";
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
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
				else {
					setTitle("");
					setGlyphId(DEFAULT_WORKSPACE_GLYPH_ID);
				}
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-gray-950/45 backdrop-blur-[1px] data-[state=open]:animate-in" />
				<Dialog.Content aria-label="New Workspace" className="fixed left-1/2 top-[20vh] z-50 w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl outline-none dark:border-gray-700 dark:bg-gray-900">
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
										className={cn(
											"grid size-8 place-items-center rounded-md text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800",
											glyphId === id && "bg-accent-10 text-accent-60 dark:bg-accent-80 dark:text-accent-30",
										)}
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
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
