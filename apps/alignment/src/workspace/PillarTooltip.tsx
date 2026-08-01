import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/**
 * A hover/focus-revealed tooltip wrapping a glyph-pillar trigger -- shared
 * by every glyph-pillar control (Workspace Selection on the left, Surface
 * Templates on the right) instead of each repeating the same positioning
 * markup with only the anchor side differing.
 *
 * Renders through Radix's own Tooltip.Portal (the same mechanism
 * CommandButton's own built-in tooltip already uses), not a CSS-`absolute`
 * box positioned relative to a `group relative` ancestor: a scrollable
 * pillar list (`overflow-auto`, many entries) measures an absolutely
 * positioned descendant's box for its own scrollable content area even
 * while that descendant is invisible (`opacity-0` doesn't remove it from
 * layout) -- a real, live bug found this way: a wide tooltip box sized for
 * its label text, sitting just past a 56px collapsed pillar's right edge,
 * silently produced a horizontal scrollbar on the pillar itself. A portal
 * escapes that ancestor's overflow box entirely, by construction.
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
