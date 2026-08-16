import * as Popover from "@radix-ui/react-popover";
import { Bell } from "lucide-react";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "@zodiac/ui";
import { iconButtonClassName } from "./icon-button-style.js";
import { UTILITY_PILL_CLASSES } from "./utility-pill-style.js";

/**
 * Notifications flanking the Window Carousel -- reuses the shared pill
 * shape (utility-pill-style.ts), Gradient to Contrast (SURFACE_BG), and
 * Icon Button (icon-button-style.ts), the same elements every other pill
 * and action in the shell already uses. A plain local toggle (Radix
 * Popover's own uncontrolled open state), not a global command -- ephemeral
 * peek UI that isn't a Workspace/Window-level action doesn't need one.
 */
export function NotificationsPill(): React.JSX.Element {
	return (
		<div className={cn(UTILITY_PILL_CLASSES, SURFACE_BG)}>
			<Popover.Root>
				<Popover.Trigger asChild>
					<button type="button" aria-label="Notifications" className={iconButtonClassName({ size: "md" })}>
						<Bell aria-hidden="true" size={15} />
					</button>
				</Popover.Trigger>
				<Popover.Portal>
					<Popover.Content align="start" sideOffset={8} className={cn("z-50 w-64 overflow-hidden rounded-[var(--app-corner-radius,16px)] border border-gray-200 p-3 shadow-2xl outline-none dark:border-gray-700", SURFACE_BG)}>
						<p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Notifications</p>
						<p className="mt-2 text-sm text-gray-600 dark:text-gray-300">No notifications yet.</p>
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>
		</div>
	);
}
