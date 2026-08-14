import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useRef } from "react";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "../platform/surface-style.js";

interface ConfirmDialogProps {
	readonly open: boolean;
	readonly title: string;
	readonly description: string;
	readonly confirmLabel: string;
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
}

/**
 * A generic "are you sure" prompt for a destructive, unrecoverable action --
 * `AlertDialog` (not plain `Dialog`, see CreateWorkspaceDialog.tsx) so
 * assistive tech announces it as an interruption requiring a decision, not
 * an ordinary panel. First real caller: closing a Workspace (WorkspaceSelection.tsx).
 */
export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps): React.JSX.Element {
	// Radix's own Action button closes the dialog on click too (same as
	// Cancel) -- onOpenChange(false) fires either way, so it can't be trusted
	// alone to mean "the user backed out". This ref records a same-tick
	// confirm so the closing onOpenChange it triggers is swallowed instead of
	// double-reporting as a cancel.
	const confirmed = useRef(false);
	return (
		<AlertDialog.Root
			open={open}
			onOpenChange={(next) => {
				if (next) return;
				if (confirmed.current) {
					confirmed.current = false;
					return;
				}
				onCancel();
			}}
		>
			<AlertDialog.Portal>
				<AlertDialog.Overlay className="fixed inset-0 z-40 bg-gray-950/45 backdrop-blur-[1px] data-[state=open]:animate-in" />
				<AlertDialog.Content className={cn("fixed left-1/2 top-[20vh] z-50 w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 shadow-2xl outline-none dark:border-gray-700", SURFACE_BG)}>
					<div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
						<AlertDialog.Title className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</AlertDialog.Title>
					</div>
					<div className="flex flex-col gap-3 p-4">
						<AlertDialog.Description className="text-sm text-gray-600 dark:text-gray-300">{description}</AlertDialog.Description>
						<div className="flex justify-end gap-2">
							<AlertDialog.Cancel asChild>
								<button type="button" className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800">
									Cancel
								</button>
							</AlertDialog.Cancel>
							<AlertDialog.Action asChild>
								<button
									type="button"
									onClick={() => {
										confirmed.current = true;
										onConfirm();
									}}
									className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-accent"
								>
									{confirmLabel}
								</button>
							</AlertDialog.Action>
						</div>
					</div>
				</AlertDialog.Content>
			</AlertDialog.Portal>
		</AlertDialog.Root>
	);
}
