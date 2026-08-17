import { useCallback, useRef } from "react";
import { nearestPanelThickness } from "./panel-resize.js";

export interface UseResizeHandleOptions {
	readonly currentThickness: number;
	/** +1 if dragging right grows this Panel (a left-edge pillar's own right-side handle); -1 if dragging left grows it instead (a right-edge pillar's own left-side handle). */
	readonly direction: 1 | -1;
	readonly onResize: (thickness: number) => void;
}

export interface ResizeHandleHandlers {
	readonly onPointerDown: (event: React.PointerEvent) => void;
}

/**
 * Pointer-drag resize that snaps only once the drag ends (see
 * nearestPanelThickness's own doc comment) -- not a continuous live-resize;
 * "snapping" means a small set of allowed values is the whole point, not
 * free drag with a snap-preview along the way. `window` listeners, not the
 * handle element's own -- the pointer routinely leaves the handle's own
 * small hit area mid-drag, and a resize must keep tracking it regardless.
 */
export function useResizeHandle({ currentThickness, direction, onResize }: UseResizeHandleOptions): ResizeHandleHandlers {
	const startRef = useRef<{ x: number; thickness: number } | undefined>(undefined);

	const onPointerDown = useCallback(
		(event: React.PointerEvent) => {
			event.preventDefault();
			startRef.current = { x: event.clientX, thickness: currentThickness };

			function onPointerMove(moveEvent: PointerEvent): void {
				moveEvent.preventDefault();
			}
			function onPointerUp(upEvent: PointerEvent): void {
				window.removeEventListener("pointermove", onPointerMove);
				window.removeEventListener("pointerup", onPointerUp);
				const start = startRef.current;
				startRef.current = undefined;
				if (!start) return;
				const delta = (upEvent.clientX - start.x) * direction;
				onResize(nearestPanelThickness(start.thickness + delta));
			}
			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", onPointerUp);
		},
		[currentThickness, direction, onResize],
	);

	return { onPointerDown };
}
