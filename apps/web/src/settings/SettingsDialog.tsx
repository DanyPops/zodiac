import * as Dialog from "@radix-ui/react-dialog";
import { Command, Keyboard, MoonStar, PanelBottom, PanelLeft, PanelRight, PanelTop, Settings } from "lucide-react";
import { DialogChrome } from "@zodiac/ui";
import { DialogCloseButton } from "../commands/DialogCloseButton.js";
import { CommandButton, useCommandShortcut } from "../commands/react.js";
import { cn } from "../platform/cn.js";
import type { ChatPlacement } from "../platform/chat-placement.js";
import { iconButtonClassName } from "../workspace/icon-button-style.js";
import { cornerRadiusPx, lineWidthPx, type ShapeSettings } from "../platform/shape-settings.js";
import { ShapeSlider } from "./ShapeSlider.js";

interface SettingsDialogProps {
	readonly open: boolean;
	readonly onClose: () => void;
	readonly value: ShapeSettings;
	readonly onStrokeWidthChange: (strokeWidth: number) => void;
	readonly onCornerRadiusChange: (cornerRadius: number) => void;
	readonly chatPlacement: ChatPlacement;
	readonly onChatPlacementChange: (placement: ChatPlacement) => void;
}

const CHAT_PLACEMENT_OPTIONS: readonly { readonly placement: ChatPlacement; readonly label: string; readonly icon: React.ComponentType<{ readonly size?: number; readonly "aria-hidden"?: boolean }> }[] = [
	{ placement: "top", label: "Top", icon: PanelTop },
	{ placement: "bottom", label: "Bottom", icon: PanelBottom },
	{ placement: "left", label: "Left", icon: PanelLeft },
	{ placement: "right", label: "Right", icon: PanelRight },
];

/**
 * The umbrella Settings dialog: shell actions (Command Palette, Keyboard
 * Shortcuts, Cycle Theme), Appearance (Stroke Width, Corner Radius), and
 * which edge Chat is docked to. All three apply live. The preview swatch
 * mirrors the live value directly, not a CSS custom property read back --
 * it can't drift from what the sliders say.
 */
export function SettingsDialog({ open, onClose, value, onStrokeWidthChange, onCornerRadiusChange, chatPlacement, onChatPlacementChange }: SettingsDialogProps): React.JSX.Element {
	return (
		<DialogChrome variant="dialog" open={open} onOpenChange={(next) => !next && onClose()} width={420} topOffsetVh={14} ariaLabel="Settings">
			<div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<Settings aria-hidden="true" size={16} className="text-gray-500" />
				<Dialog.Title className="text-sm font-semibold text-gray-900 dark:text-gray-100">Settings</Dialog.Title>
				<DialogCloseButton label="Close Settings" />
			</div>
			<Dialog.Description className="sr-only">Shell actions, the Shape (Stroke Width and Corner Radius) appearance controls, and which edge Chat is docked to. Changes apply immediately and persist across reloads.</Dialog.Description>

			<div className="border-b border-gray-200 p-2 dark:border-gray-700">
				<p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">Shell</p>
				<SettingsRow commandId="palette.open" label="Command Palette" icon={<Command aria-hidden="true" size={15} />} />
				<SettingsRow commandId="shortcuts.open" label="Keyboard Shortcuts" icon={<Keyboard aria-hidden="true" size={15} />} />
				<SettingsRow commandId="theme.cycle" label="Cycle Theme" icon={<MoonStar aria-hidden="true" size={15} />} />
			</div>

			<div className="border-b border-gray-200 p-4 dark:border-gray-700">
				<p className="pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">Appearance</p>
				<div className="flex items-center gap-4">
					<div className="flex flex-1 flex-col gap-5">
						<ShapeSlider id="shape-stroke-width" label="Stroke Width" value={value.strokeWidth} onChange={onStrokeWidthChange} minLabel="Cartoon" midLabel="Comfy" maxLabel="Professional" />
						<ShapeSlider id="shape-corner-radius" label="Corner Radius" value={value.cornerRadius} onChange={onCornerRadiusChange} minLabel="Square" maxLabel="Circle" />
					</div>
					<div
						aria-hidden="true"
						data-testid="shape-preview"
						className="size-16 shrink-0 bg-accent-10 dark:bg-accent-80"
						style={{ borderWidth: `${lineWidthPx(value.strokeWidth)}px`, borderStyle: "solid", borderColor: "var(--color-accent)", borderRadius: `${cornerRadiusPx(value.cornerRadius)}px` }}
					/>
				</div>
			</div>

			<div className="p-4">
				<p className="pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400">Chat</p>
				<div className="flex items-center gap-2">
					{CHAT_PLACEMENT_OPTIONS.map(({ placement, label, icon: Icon }) => (
						<button
							key={placement}
							type="button"
							onClick={() => onChatPlacementChange(placement)}
							aria-label={`Dock Chat to the ${label}`}
							aria-pressed={placement === chatPlacement}
							className={cn(iconButtonClassName({ size: "md" }), placement === chatPlacement && "bg-accent-10 text-accent-80 dark:bg-accent-70 dark:text-accent-10")}
						>
							<Icon aria-hidden size={16} />
						</button>
					))}
				</div>
			</div>
		</DialogChrome>
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
