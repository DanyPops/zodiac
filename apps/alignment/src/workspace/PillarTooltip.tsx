/**
 * A hover/focus-revealed tooltip anchored beside a `group`-marked trigger --
 * shared by every glyph-pillar control (Workspace Selection on the left,
 * Surface Templates on the right) instead of each repeating the same
 * positioning and reveal markup with only the anchor side differing.
 */
export function PillarTooltip({ side, label, shortcut }: { readonly side: "left" | "right"; readonly label: string; readonly shortcut?: string }): React.JSX.Element {
	const sideClasses = side === "right" ? "left-full ml-2" : "right-full mr-2";
	return (
		<div role="tooltip" className={`pointer-events-none invisible absolute top-1/2 z-50 ${sideClasses} -translate-y-1/2 whitespace-nowrap rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-white opacity-0 shadow-lg group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100`}>
			<span className="block">{label}</span>
			{shortcut && <kbd className="mt-0.5 block font-mono text-[10px] text-gray-400">{shortcut}</kbd>}
		</div>
	);
}
