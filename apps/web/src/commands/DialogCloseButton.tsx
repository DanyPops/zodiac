import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { CommandButton } from "./react.js";

interface DialogCloseButtonProps {
	/** e.g. "Close Settings" -- every dialog phrases this the same way, just naming itself. */
	readonly label: string;
}

/**
 * Every Zodiac dialog's own close (X) button -- one definition instead
 * of the same `Dialog.Close asChild` + `CommandButton commandId="dialog.close"`
 * + class string repeated verbatim across Settings, the command palette,
 * Surface Templates, and its gallery.
 */
export function DialogCloseButton({ label }: DialogCloseButtonProps): React.JSX.Element {
	return (
		<Dialog.Close asChild>
			<CommandButton commandId="dialog.close" label={label} className="ml-auto rounded-md p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-gray-800">
				<X aria-hidden="true" size={16} />
			</CommandButton>
		</Dialog.Close>
	);
}
