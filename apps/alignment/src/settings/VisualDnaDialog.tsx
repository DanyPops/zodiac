import * as Dialog from "@radix-ui/react-dialog";
import { Settings, X } from "lucide-react";
import { CommandButton } from "../commands/react.js";
import { cornerRadiusPx, lineWidthPx, type VisualDna } from "../platform/visual-dna.js";
import { VisualDnaSlider } from "./VisualDnaSlider.js";

interface VisualDnaDialogProps {
	readonly open: boolean;
	readonly onClose: () => void;
	readonly value: VisualDna;
	readonly onVibeChange: (vibe: number) => void;
	readonly onCornerSharpnessChange: (cornerSharpness: number) => void;
}

/**
 * The gear-icon settings panel for the shell's own Visual DNA: Vibe (line
 * neatness, Cartoon to Professional) and Corner Sharpness (Square to
 * Circle). Both sliders apply live -- see visual-dna-hooks.ts -- so the
 * shell behind this dialog re-styles as it's dragged, not only on close.
 * The preview swatch mirrors that same live value directly (not by reading
 * the CSS custom property back out of the document) so it can't drift from
 * what the sliders actually say.
 */
export function VisualDnaDialog({ open, onClose, value, onVibeChange, onCornerSharpnessChange }: VisualDnaDialogProps): React.JSX.Element {
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-gray-950/45 backdrop-blur-[1px] data-[state=open]:animate-in" />
				<Dialog.Content aria-label="Visual DNA" className="fixed left-1/2 top-[14vh] z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl outline-none dark:border-gray-700 dark:bg-gray-900">
					<div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
						<Settings aria-hidden="true" size={16} className="text-gray-500" />
						<Dialog.Title className="text-sm font-semibold text-gray-900 dark:text-gray-100">Visual DNA</Dialog.Title>
						<Dialog.Close asChild>
							<CommandButton commandId="dialog.close" label="Close Visual DNA" className="ml-auto rounded-md p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-gray-800">
								<X aria-hidden="true" size={16} />
							</CommandButton>
						</Dialog.Close>
					</div>
					<Dialog.Description className="sr-only">Adjust the shell&apos;s Vibe and Corner Sharpness. Changes apply immediately and persist across reloads.</Dialog.Description>

					<div className="flex items-center gap-4 p-4">
						<div className="flex flex-1 flex-col gap-5">
							<VisualDnaSlider id="visual-dna-vibe" label="Vibe" value={value.vibe} onChange={onVibeChange} minLabel="Cartoon" midLabel="Comfy" maxLabel="Professional" />
							<VisualDnaSlider id="visual-dna-corner" label="Corner Sharpness" value={value.cornerSharpness} onChange={onCornerSharpnessChange} minLabel="Square" maxLabel="Circle" />
						</div>
						<div
							aria-hidden="true"
							data-testid="visual-dna-preview"
							className="size-16 shrink-0 bg-accent-10 dark:bg-accent-80"
							style={{ borderWidth: `${lineWidthPx(value.vibe)}px`, borderStyle: "solid", borderColor: "var(--color-accent)", borderRadius: `${cornerRadiusPx(value.cornerSharpness)}px` }}
						/>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
