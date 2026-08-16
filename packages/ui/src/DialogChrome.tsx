import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "./cn.js";
import { SURFACE_BG } from "./surface-style.js";

/**
 * The one recurring "modal dialog" shell across Zodiac Web -- overlay plus
 * a centered, width-capped, rounded content panel -- found hand-copied
 * verbatim across 7 real call sites (CommandDialog, SettingsDialog,
 * CreateWorkspaceDialog, SaveAsTemplateDialog, SurfaceTemplatesGallery,
 * TemplatesDialog, ConfirmDialog) before this extraction. Owns no domain
 * content or interaction logic of its own -- purely the overlay/content
 * chrome, the same discipline Malevich's BorderedSelectPanel uses for
 * "owns no selection logic, wraps a host-provided list".
 *
 * `width`/`topOffsetVh` are a closed set, not free-form numbers: Tailwind's
 * JIT scanner needs every utility class as a literal, statically-scannable
 * string in this file's own source text -- a class string built from a
 * runtime template literal (e.g. `` `top-[${n}vh]` ``) is invisible to it
 * and silently emits no CSS at all. Add a new literal case to
 * WIDTH_CLASSES/TOP_OFFSET_CLASSES (and widen its own type) for a new
 * size, rather than trying to parameterize freely.
 */
export type DialogChromeWidth = 360 | 420 | 560 | 640;
export type DialogChromeTopOffset = 10 | 14 | 20;
export type DialogChromeVariant = "dialog" | "alert";

const OVERLAY_CLASSES = "fixed inset-0 z-40 bg-gray-950/45 backdrop-blur-[1px] data-[state=open]:animate-in";

const WIDTH_CLASSES: Record<DialogChromeWidth, string> = {
	360: "w-[min(360px,calc(100vw-2rem))]",
	420: "w-[min(420px,calc(100vw-2rem))]",
	560: "w-[min(560px,calc(100vw-2rem))]",
	640: "w-[min(640px,calc(100vw-2rem))]",
};

const TOP_OFFSET_CLASSES: Record<DialogChromeTopOffset, string> = {
	10: "top-[10vh]",
	14: "top-[14vh]",
	20: "top-[20vh]",
};

function contentClassName(width: DialogChromeWidth, topOffsetVh: DialogChromeTopOffset): string {
	return cn("fixed left-1/2 z-50 -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 shadow-2xl outline-none dark:border-gray-700", TOP_OFFSET_CLASSES[topOffsetVh], WIDTH_CLASSES[width], SURFACE_BG);
}

export interface DialogChromeProps {
	/** "dialog" renders Radix Dialog (an ordinary panel); "alert" renders Radix AlertDialog (an interruption requiring a decision, e.g. a destructive confirmation) -- see ConfirmDialog.tsx. */
	readonly variant: DialogChromeVariant;
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly width: DialogChromeWidth;
	readonly topOffsetVh: DialogChromeTopOffset;
	/** Only meaningful for variant="dialog" -- an AlertDialog derives its accessible name from its own Title descendant instead. */
	readonly ariaLabel?: string;
	/** The dialog's own header/body/footer JSX -- may freely use Dialog.Title/Description or AlertDialog.Title/Description/Cancel/Action per its variant, since React context passes through this wrapper untouched. */
	readonly children: React.ReactNode;
}

export function DialogChrome({ variant, open, onOpenChange, width, topOffsetVh, ariaLabel, children }: DialogChromeProps): React.JSX.Element {
	const className = contentClassName(width, topOffsetVh);
	if (variant === "alert") {
		return (
			<AlertDialog.Root open={open} onOpenChange={onOpenChange}>
				<AlertDialog.Portal>
					<AlertDialog.Overlay className={OVERLAY_CLASSES} />
					<AlertDialog.Content className={className}>{children}</AlertDialog.Content>
				</AlertDialog.Portal>
			</AlertDialog.Root>
		);
	}
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className={OVERLAY_CLASSES} />
				<Dialog.Content aria-label={ariaLabel} className={className}>
					{children}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
