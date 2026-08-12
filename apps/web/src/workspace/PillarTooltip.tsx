import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/**
 * A hover/focus-revealed tooltip wrapping a glyph-pillar trigger -- shared
 * by every glyph-pillar control (Workspace Selection, Surface Templates)
 * instead of each repeating the same positioning markup.
 *
 * Renders through Radix's Tooltip.Portal (same mechanism as CommandButton's
 * own built-in tooltip), not a CSS-`absolute` box inside the scrollable
 * pillar list: a positioned-but-invisible descendant still counts toward
 * its scrollable ancestor's overflow, which can produce a phantom
 * scrollbar. A portal escapes that ancestor's overflow box by construction.
 */
export function PillarTooltip({ side, label, shortcut, children }: { readonly side: "left" | "right"; readonly label: string; readonly shortcut?: string; readonly children: ReactNode }): React.JSX.Element {
	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content side={side} sideOffset={8} className="z-50 flex items-center gap-2 rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-white shadow-lg">
					<span>{label}</span>
					{shortcut && <kbd className="rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-gray-200">{shortcut}</kbd>}
					<Tooltip.Arrow className="fill-gray-950" />
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}
