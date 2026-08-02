import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "../platform/surface-style.js";

interface SaveAsTemplateDialogProps {
	readonly open: boolean;
	readonly defaultTitle: string;
	readonly onClose: () => void;
	readonly onSave: (title: string) => void;
}

/** Reached from a docked Surface's own tab context menu ("Save as template") -- not the Surface Templates pillar, which only browses/docks existing templates. */
export function SaveAsTemplateDialog({ open, defaultTitle, onClose, onSave }: SaveAsTemplateDialogProps): React.JSX.Element {
	const [title, setTitle] = useState(defaultTitle);

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
				else setTitle(defaultTitle);
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-gray-950/45 backdrop-blur-[1px] data-[state=open]:animate-in" />
				<Dialog.Content aria-label="Save as template" className={cn("fixed left-1/2 top-[20vh] z-50 w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 shadow-2xl outline-none dark:border-gray-700", SURFACE_BG)}>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (title.trim()) onSave(title);
						}}
					>
						<div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
							<Dialog.Title className="text-sm font-semibold text-gray-900 dark:text-gray-100">Save as template</Dialog.Title>
						</div>
						<Dialog.Description className="sr-only">Name a new Surface Template based on this docked Surface.</Dialog.Description>
						<div className="flex flex-col gap-3 p-4">
							<input
								autoFocus
								aria-label="Template title"
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-20 dark:border-gray-600 dark:bg-gray-800"
							/>
							<div className="flex justify-end gap-2">
								{/* Dialog.Close alone is enough: it triggers onOpenChange(false) above, which already calls onClose -- this dialog's open state is local to WindowDockview, not the shell's own global dialogMode enum, so there's no separate command to dispatch. */}
								<Dialog.Close asChild>
									<button type="button" className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800">
										Cancel
									</button>
								</Dialog.Close>
								<button type="submit" disabled={!title.trim()} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-60 disabled:cursor-not-allowed disabled:opacity-45">
									Save
								</button>
							</div>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
