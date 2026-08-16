import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useRef } from "react";
import { DialogChrome } from "./DialogChrome.js";

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
 * DialogChrome's "alert" variant (not "dialog", see CommandDialog) so
 * assistive tech announces it as an interruption requiring a decision, not
 * an ordinary panel. First real caller: closing a Workspace
 * (apps/web/src/workspace/WorkspaceSelection.tsx).
 */
export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps): React.JSX.Element {
	// Radix's own Action button closes the dialog on click too (same as
	// Cancel) -- onOpenChange(false) fires either way, so it can't be trusted
	// alone to mean "the user backed out". This ref records a same-tick
	// confirm so the closing onOpenChange it triggers is swallowed instead of
	// double-reporting as a cancel.
	const confirmed = useRef(false);
	return (
		<DialogChrome
			variant="alert"
			open={open}
			width={360}
			topOffsetVh={20}
			onOpenChange={(next) => {
				if (next) return;
				if (confirmed.current) {
					confirmed.current = false;
					return;
				}
				onCancel();
			}}
		>
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
		</DialogChrome>
	);
}
