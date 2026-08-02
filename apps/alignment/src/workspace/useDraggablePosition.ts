import { useEffect, useRef, useState } from "react";
import type { DragTracker } from "../platform/drag-tracker.js";
import { applyDragDelta, computeDragDelta, type ChatPosition, type PointerSample } from "./chat-drag.js";

export interface DraggablePositionHandle {
	position: ChatPosition;
	/** Wire onto the drag handle's onPointerDown. */
	onDragHandlePointerDown: (event: { clientX: number; clientY: number }) => void;
	dragging: boolean;
}

/** A position a pointer-down-on-a-handle-then-move gesture can drag around, via the DragTracker port (real global pointermove/up, or a fake in tests). */
export function useDraggablePosition(initial: ChatPosition, tracker: DragTracker): DraggablePositionHandle {
	const [position, setPosition] = useState(initial);
	const [dragging, setDragging] = useState(false);
	const dragRef = useRef<{ start: PointerSample; base: ChatPosition } | null>(null);

	useEffect(
		() =>
			tracker.onMove((clientX, clientY) => {
				const drag = dragRef.current;
				if (!drag) return;
				setPosition(applyDragDelta(drag.base, computeDragDelta(drag.start, { clientX, clientY })));
			}),
		[tracker],
	);

	useEffect(
		() =>
			tracker.onUp(() => {
				dragRef.current = null;
				setDragging(false);
			}),
		[tracker],
	);

	return {
		position,
		dragging,
		onDragHandlePointerDown(event) {
			dragRef.current = { start: { clientX: event.clientX, clientY: event.clientY }, base: position };
			setDragging(true);
		},
	};
}
