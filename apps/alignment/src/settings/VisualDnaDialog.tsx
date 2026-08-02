import * as Dialog from "@radix-ui/react-dialog";
import { Command, Keyboard, MoonStar, Settings, X } from "lucide-react";
import { CommandButton, useCommandShortcut } from "../commands/react.js";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "../platform/surface-style.js";
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
 * The umbrella Settings dialog: shell-level actions (Command Palette,
 * Keyboard Shortcuts, Cycle Theme -- folded here from the collapsed
 * Workspace Selection pillar's own separate icons) plus the Appearance
 * section (Vibe, line neatness Cartoon to Professional; Corner Sharpness,
 * Square to Circle). Both sliders apply live -- see visual-dna-hooks.ts --
 * so the shell behind this dialog re-styles as it's dragged, not only on
 * close. The preview swatch mirrors that same live value directly (not by
 * reading the CSS custom property back out of the document) so it can't
 * drift from what the sliders actually say.
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
				<Dialog.Content aria-label="Settings" className={cn("fixed left-1/2 top-[14vh] z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 shadow-2xl outline-none dark:border-gray-700", SURFACE_BG)}>
					<div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
						<Settings aria-hidden="true" size={16} className="text-gray-500" />
						<Dialog.Title className="text-sm font-semibold text-gray-900 dark:text-gray-100">Settings</Dialog.Title>
						<Dialog.Close asChild>
							<CommandButton commandId="dialog.close" label="Close Settings" className="ml-auto rounded-md p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-gray-800">
								<X aria-hidden="true" size={16} />
							</CommandButton>
						</Dialog.Close>
					</div>
					<Dialog.Description className="sr-only">Shell actions and the Visual DNA (Vibe and Corner Sharpness) appearance controls. Changes apply immediately and persist across reloads.</Dialog.Description>

					<div className="border-b border-gray-200 p-2 dark:border-gray-700">
						<p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">Shell</p>
						<SettingsRow commandId="palette.open" label="Command Palette" icon={<Command aria-hidden="true" size={15} />} />
						<SettingsRow commandId="shortcuts.open" label="Keyboard Shortcuts" icon={<Keyboard aria-hidden="true" size={15} />} />
						<SettingsRow commandId="theme.cycle" label="Cycle Theme" icon={<MoonStar aria-hidden="true" size={15} />} />
					</div>

					<div className="p-4">
						<p className="pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">Appearance</p>
						<div className="flex items-center gap-4">
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
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

/** One shell-action row folded into Settings -- executing it (e.g. palette.open) switches the active dialog away from Settings itself, per useCommandContextStack's single dialogMode. */
function SettingsRow({ commandId, label, icon }: { readonly commandId: string; readonly label: string; readonly icon: React.ReactNode }): React.JSX.Element {
	const shortcut = useCommandShortcut(commandId);
	return (
		<CommandButton commandId={commandId} label={label} tooltip={false} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent dark:text-gray-200 dark:hover:bg-gray-800">
			{icon}
			<span className="flex-1">{label}</span>
			<kbd className="font-mono text-[10px] text-gray-500 dark:text-gray-400">{shortcut}</kbd>
		</CommandButton>
	);
}
