import type { DockRulerHint } from "./dock-ruler.js";

interface DockRulerProps {
	readonly width: number;
	readonly height: number;
	readonly hint: DockRulerHint;
}

/**
 * The live shaded preview shown over an existing docked Surface's own
 * content while dragging -- exactly how much of the pane the new split
 * will take. The ruler's own ticks/labels live outside the content
 * entirely now, in DockRulerFrame's outer bars; this is deliberately just
 * the in-content preview, `pointer-events-none` so it never competes with
 * the native HTML5 drag events dockview itself listens for underneath it.
 */
export function DockRuler({ width, height, hint }: DockRulerProps): React.JSX.Element {
	const horizontal = hint.axis === "horizontal";
	const activeAxisPx = horizontal ? width * hint.guide.ratio : height * hint.guide.ratio;
	const fromStart = hint.edge === "left" || hint.edge === "top";
	const shadeStyle = horizontal
		? { top: 0, height, left: fromStart ? 0 : activeAxisPx, width: fromStart ? activeAxisPx : width - activeAxisPx }
		: { left: 0, width, top: fromStart ? 0 : activeAxisPx, height: fromStart ? activeAxisPx : height - activeAxisPx };

	return <div data-testid="dock-ruler-shade" className="pointer-events-none absolute z-40 bg-accent/15" style={shadeStyle} />;
}
