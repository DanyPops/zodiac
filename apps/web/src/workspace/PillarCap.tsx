import { forwardRef, type ButtonHTMLAttributes } from "react";
import { CommandButton } from "../commands/react.js";
import { cn } from "../platform/cn.js";

interface PillarCapProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> {
	readonly commandId: string;
	readonly label: string;
	/** Which pillar edge this cap sits on -- governs which side gets the divider against the rest of the pillar. */
	readonly edge: "top" | "bottom";
	readonly children: React.ReactNode;
}

/**
 * "Pillar Cap": a Pillar's own top or bottom terminal cell -- full pillar
 * width (`w-14`), fixed height (`h-12`), its glyph centered directly inside
 * with no separate nested badge/chip. As a direct child of the Pillar's own
 * `overflow-hidden` nav, the glyph sits flush against whatever curvature
 * `--app-corner-radius` gives that corner (see WorkspaceSelection.tsx's own
 * Pillar Cap comment) -- the Surface Templates pillar's book icon is the
 * reference implementation every Pillar Cap now shares.
 *
 * forwardRef + rest-prop spread: every call site wraps this in
 * PillarTooltip, whose Tooltip.Trigger asChild clones a ref and hover/focus
 * handlers onto it. A plain component silently drops both -- tooltip never
 * opens, no error (a real bug this once had, three call sites affected).
 */
export const PillarCap = forwardRef<HTMLButtonElement, PillarCapProps>(function PillarCap({ commandId, label, edge, children, ...rest }, ref) {
	return (
		<CommandButton
			ref={ref}
			commandId={commandId}
			label={label}
			tooltip={false}
			className={cn(
				"group grid h-12 w-14 shrink-0 place-items-center text-gray-600 hover:bg-gray-200 focus-visible:outline-2 focus-visible:outline-accent dark:text-gray-300 dark:hover:bg-gray-800",
				edge === "top" ? "border-b-[length:var(--app-line-width)] border-gray-200 dark:border-gray-700" : "border-t-[length:var(--app-line-width)] border-gray-200 dark:border-gray-700",
			)}
			{...rest}
		>
			{children}
		</CommandButton>
	);
});
