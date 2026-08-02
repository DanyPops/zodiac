/** Pure drag math for the floating Chat Surface -- real position state, not a fixed popup. */
export interface ChatPosition {
	x: number;
	y: number;
}

export interface PointerSample {
	readonly clientX: number;
	readonly clientY: number;
}

/** How far the pointer has moved since a drag started. */
export function computeDragDelta(start: PointerSample, current: PointerSample): ChatPosition {
	return { x: current.clientX - start.clientX, y: current.clientY - start.clientY };
}

/** The dragged panel's new position: wherever it was when the drag started, plus how far the pointer has since moved. */
export function applyDragDelta(base: ChatPosition, delta: ChatPosition): ChatPosition {
	return { x: base.x + delta.x, y: base.y + delta.y };
}
